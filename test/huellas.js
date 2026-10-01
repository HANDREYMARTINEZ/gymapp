const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-huellas-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-huellas-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();
    const dekMod = require('../electron/crypto/dek');
    const huellas = require('../electron/services/huellas');
    const clientes = require('../electron/db/repos/clientes');

    dekMod.guardarDekEnMemoria(dekMod.generarDEK());

    const ana = clientes.crear({ documento: '111', nombre: 'Ana', telefono: '300' });
    const beto = clientes.crear({ documento: '222', nombre: 'Beto', telefono: '301' });

    // Es lo que decide si el boton dice "Registrar huella" o "Sustituir huella".
    check('un cliente recien creado no tiene huellas',
          huellas.listarPorCliente(ana).length === 0);

    const plantilla = Buffer.from('plantilla-de-prueba-de-la-huella');
    huellas.guardarHuella(ana, 'indice_derecho', plantilla);

    const suyas = huellas.listarPorCliente(ana);
    check('tras enrolar aparece una huella', suyas.length === 1, 'tiene ' + suyas.length);
    check('y dice de que dedo es', suyas[0].dedo === 'indice_derecho', suyas[0].dedo);
    check('el listado NO devuelve la plantilla biometrica',
          !('template' in suyas[0]), Object.keys(suyas[0]).join(', '));

    check('la plantilla se guarda cifrada, no en claro',
          db.prepare(`SELECT template FROM huellas WHERE cliente_id = ?`).get(ana)
            .template.indexOf(plantilla) === -1);

    // Sustituir: vuelve a enrolar el mismo dedo y no deja dos filas.
    huellas.guardarHuella(ana, 'indice_derecho', Buffer.from('otra-plantilla-distinta'));
    check('sustituir la huella no deja dos filas del mismo dedo',
          huellas.listarPorCliente(ana).length === 1);
    check('y la que queda es la nueva',
          huellas.cargarTodasLasHuellas()
            .find(h => h.clienteId === ana).templateBase64
              === Buffer.from('otra-plantilla-distinta').toString('base64'));

    // Otro dedo si es otra fila.
    huellas.guardarHuella(ana, 'pulgar_izquierdo', Buffer.from('pulgar'));
    check('otro dedo si se guarda aparte', huellas.listarPorCliente(ana).length === 2);

    // Eliminar
    huellas.guardarHuella(beto, 'indice_derecho', Buffer.from('la-de-beto'));
    const borrada = huellas.eliminarHuella(ana, 'indice_derecho');
    check('eliminar borra esa huella', borrada.ok && borrada.borradas === 1);
    check('y solo esa: el otro dedo sigue',
          huellas.listarPorCliente(ana).length === 1 &&
          huellas.listarPorCliente(ana)[0].dedo === 'pulgar_izquierdo');
    check('y no toca las de otro cliente', huellas.listarPorCliente(beto).length === 1);
    check('borrar algo que ya no estaba no es un error',
          huellas.eliminarHuella(ana, 'indice_derecho').borradas === 0);

    // El kiosco solo debe cargar las que quedan.
    check('el kiosco carga solo las huellas que siguen registradas',
          huellas.cargarTodasLasHuellas().length === 2,
          'cargo ' + huellas.cargarTodasLasHuellas().length);

    // Dar de baja tiene que cerrarle TAMBIEN la puerta de la huella. Hasta el
    // 18-sep-2026 solo se la cerraba por PIN -- la identificacion filtra por
    // activo = 1 -- y por huella entraba igual: la plantilla se cargaba en el
    // lector y la asistencia se registraba (y la puerta se abria).
    const asistencias = require('../electron/db/repos/asistencias');
    const antesDeLaBaja = huellas.cargarTodasLasHuellas().length;
    clientes.darDeBaja({ clienteId: beto, usuarioId: null, motivo: 'prueba' });
    check('la huella de un cliente dado de baja no se carga en el lector',
          huellas.cargarTodasLasHuellas().length === antesDeLaBaja - 1,
          'cargo ' + huellas.cargarTodasLasHuellas().length + ' de ' + antesDeLaBaja);
    check('y ninguna de las cargadas es suya',
          !huellas.cargarTodasLasHuellas().some(h => h.clienteId === beto));
    check('aunque llegue por otro camino, la asistencia se rechaza',
          asistencias.registrar({ clienteId: beto, metodo: 'huella', registradoPor: null }).motivo === 'cliente_inactivo');

    clientes.reactivar({ clienteId: beto, usuarioId: null });
    check('al darle de alta otra vez, su huella vuelve al lector',
          huellas.cargarTodasLasHuellas().some(h => h.clienteId === beto));

    // ------------------------------------------------- el lector que se atasca
    //
    // 30-sep-2026 en el gimnasio: el lector veia cada dedo pero no entregaba
    // ninguna huella, y el kiosco paso medio dia sin reconocer a nadie y sin
    // decirlo. El sidecar lo detecta y lo avisa; aqui se prueba que la app lo
    // recoge, sin necesitar el lector fisico.
    const sidecar = require('../electron/services/sidecarHuella');
    const avisos = [];
    const dejar = sidecar.onCambioAtasco(v => avisos.push(v));
    check('arranca sin atasco', sidecar.estaAtascado() === false);
    sidecar._manejarMensaje({ evento: 'lectorAtascado', toques: 3 });
    check('el aviso del sidecar marca el lector como atascado', sidecar.estaAtascado() === true);
    sidecar._manejarMensaje({ evento: 'lectorAtascado', toques: 4 });
    check('y se reparte una sola vez, no en cada toque',
          avisos.length === 1 && avisos[0] === true, JSON.stringify(avisos));
    sidecar._manejarMensaje({ evento: 'lectorRecuperado' });
    check('cuando vuelve a llegar una huella se quita el aviso',
          sidecar.estaAtascado() === false && avisos.join() === 'true,false', JSON.stringify(avisos));
    dejar();
    sidecar._manejarMensaje({ evento: 'lectorAtascado', toques: 3 });
    check('quien deja de escuchar ya no recibe nada', avisos.length === 2);
    sidecar._manejarMensaje({ evento: 'lectorRecuperado' });

    // El que pasaba por el PC del gimnasio sin esta historia leyo "Priority.High es
    // la clave" en un comentario viejo y recomendo subir la prioridad. High no se
    // puede ni crear; ver test/sidecar.js.
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'sidecar-huella', 'SidecarForm.cs'), 'utf-8');
    check('el sidecar sigue contando toques sin muestra', fuente.includes('TOQUES_PARA_ATASCO'));
    check('y ningun comentario vuelve a recomendar Priority.High',
          !/Priority\.High es la clave/.test(fuente));

    db.close();
  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallos === 0 ? 0 : 1);
});
