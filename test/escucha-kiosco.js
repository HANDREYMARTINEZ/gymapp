const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

// La escucha compartida del lector de huella (electron/services/escuchaKiosco.js)
// con dos kioscos abiertos: la ventana principal y la segunda pantalla. No
// necesita el lector: el sidecar se sustituye por uno de mentira que apunta lo
// que le mandan y deja disparar "huellas" a mano. La puerta queda desactivada
// (base nueva), asi que esta suite no puede abrir la del gimnasio.

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-escucha-kiosco-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-escucha-kiosco-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const handlers = {};
const registrarOriginal = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (canal, fn) => { handlers[canal] = fn; registrarOriginal(canal, fn); };

// Una ventana de mentira: lo unico que la escucha usa de un webContents.
let siguienteId = 1;
function ventanaFalsa() {
  const wc = new EventEmitter();
  wc.id = siguienteId++;
  wc.recibido = [];
  wc.destruida = false;
  wc.isDestroyed = () => wc.destruida;
  wc.send = (canal, datos) => { wc.recibido.push({ canal, datos }); };
  wc.cerrar = () => { wc.destruida = true; wc.emit('destroyed'); };
  wc.de = (canal) => wc.recibido.filter(m => m.canal === canal).map(m => m.datos);
  return wc;
}

const espera = (ms) => new Promise(r => setTimeout(r, ms));

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
    dekMod.guardarDekEnMemoria(dekMod.generarDEK());

    // El sidecar de mentira. Se reemplazan las funciones en el mismo objeto que
    // exporta el modulo, que es el que usan escuchaKiosco e ipc/huellas.
    const sidecar = require('../electron/services/sidecarHuella');
    const falso = { callback: null, cargas: [], detenciones: 0, enrolamientos: 0, abierto: true };
    sidecar.iniciarVerificacion = async (templates, cb) => {
      falso.cargas.push(templates.length);
      falso.callback = cb;
    };
    sidecar.detenerVerificacion = (soloSi) => {
      if (soloSi && falso.callback !== soloSi) return;
      falso.detenciones++;
      falso.callback = null;
    };
    let terminarEnrolamiento = null;
    sidecar.enrolar = () => new Promise((resolve) => {
      falso.enrolamientos++;
      // Enrolar deja el sidecar en reposo, como el de verdad (SidecarForm.cs).
      falso.callback = null;
      terminarEnrolamiento = resolve;
    });
    sidecar.estaAbierto = () => falso.abierto;
    const huella = async (clienteId) => { if (falso.callback) await falso.callback(clienteId); await espera(50); };

    const clientes = require('../electron/db/repos/clientes');
    const membresias = require('../electron/db/repos/membresias');
    const planes = require('../electron/db/repos/planes');
    const caja = require('../electron/db/repos/caja');
    const huellas = require('../electron/services/huellas');
    const escucha = require('../electron/services/escuchaKiosco');
    require('../electron/ipc/kiosco');
    require('../electron/ipc/huellas');

    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Cajero', 'cajero', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;
    caja.abrir({ usuarioId, baseInicial: 100000 });
    const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 70000, dias_duracion: 30 });
    const camila = clientes.crear({ documento: '9900001001', nombre: 'Camila Castro', telefono: '300' });
    const beto = clientes.crear({ documento: '9900001002', nombre: 'Beto Rojas', telefono: '301' });
    for (const id of [camila, beto]) {
      const m = membresias.vender({ clienteId: id, planId: mensual, usuarioId });
      membresias.registrarPago({ membresiaId: m, monto: 70000, metodo: 'Efectivo', usuarioId });
    }
    huellas.guardarHuella(camila, 'indice_derecho', Buffer.from('plantilla-camila'));

    const asistenciasDe = (id) => db.prepare(`SELECT COUNT(*) n FROM asistencias WHERE cliente_id = ?`).get(id).n;

    // ------------------------------------------------- dos kioscos, un lector
    const principal = ventanaFalsa();
    const segunda = ventanaFalsa();

    const r1 = await handlers['kiosco:iniciarEscuchaHuella']({ sender: principal });
    check('el primer kiosco arma el lector con las huellas guardadas',
          r1.ok && r1.armado && r1.cantidad === 1, JSON.stringify(r1));
    await handlers['kiosco:iniciarEscuchaHuella']({ sender: segunda });
    check('el segundo kiosco no lo deja sin oyente', typeof falso.callback === 'function');

    await huella(camila);
    check('una huella con dos kioscos abiertos registra UNA asistencia', asistenciasDe(camila) === 1,
          'asistencias: ' + asistenciasDe(camila));
    const enPrincipal = principal.de('kiosco:huellaDetectada');
    const enSegunda = segunda.de('kiosco:huellaDetectada');
    check('y el mensaje sale en las dos ventanas', enPrincipal.length === 1 && enSegunda.length === 1);
    check('con el nombre y el ok de la asistencia',
          enSegunda[0] && enSegunda[0].ok === true && enSegunda[0].nombre === 'Camila Castro',
          JSON.stringify(enSegunda[0] && { ok: enSegunda[0].ok, nombre: enSegunda[0].nombre }));
    check('la puerta queda desactivada en la prueba', enSegunda[0] && enSegunda[0].puerta === 'desactivada');

    // ------------- recepcion sale del kiosco para vender: la segunda sigue
    await handlers['kiosco:detenerEscuchaHuella']({ sender: principal });
    check('salir del kiosco en la principal NO desarma el lector de la segunda pantalla',
          typeof falso.callback === 'function', 'detenciones: ' + falso.detenciones);

    await huella(camila);
    check('la huella sigue llegando a la segunda pantalla', segunda.de('kiosco:huellaDetectada').length === 2);
    check('y ya no a la ventana que salio del kiosco', principal.de('kiosco:huellaDetectada').length === 1);
    check('la segunda huella del dia es reingreso, no otra asistencia',
          asistenciasDe(camila) === 1 && segunda.de('kiosco:huellaDetectada')[1].reingreso === true);

    // ---------------------------------- enrolar con la segunda pantalla abierta
    const enrolando = handlers['huellas:enrolar'](null, { clienteId: beto, dedo: 'indice_derecho' });
    await espera(30);
    check('al enrolar, la segunda pantalla se entera de que el lector esta ocupado',
          segunda.de('kiosco:lectorOcupado').slice(-1)[0] === true);
    check('y el kiosco deja de tener el lector mientras tanto', falso.callback === null);
    check('el canal de consulta tambien lo dice', handlers['kiosco:lectorOcupado']() === true);

    terminarEnrolamiento(Buffer.from('plantilla-beto').toString('base64'));
    const re = await enrolando;
    await espera(50);
    check('el enrolamiento termina bien', re.ok === true, JSON.stringify(re));
    check('al terminar el lector vuelve a la segunda pantalla', typeof falso.callback === 'function');
    check('y se recargan las huellas: ya van 2', falso.cargas.slice(-1)[0] === 2, JSON.stringify(falso.cargas));
    check('el aviso de ocupado se apaga', segunda.de('kiosco:lectorOcupado').slice(-1)[0] === false);

    await huella(beto);
    check('la huella recien enrolada entra sin reiniciar nada', asistenciasDe(beto) === 1);

    // -------------------------------- borrar una huella recarga el sidecar
    const cargasAntes = falso.cargas.length;
    await handlers['huellas:eliminar'](null, beto, 'indice_derecho');
    await espera(50);
    check('borrar una huella le manda al lector la lista nueva',
          falso.cargas.length === cargasAntes + 1 && falso.cargas.slice(-1)[0] === 1,
          JSON.stringify(falso.cargas));

    // ---------------------- el login de desarrollador reserva el lector
    const reserva = escucha.reservar();
    await reserva.desarmado;
    check('una reserva quita el lector al kiosco', falso.callback === null);
    const ajeno = async () => {};
    await sidecar.iniciarVerificacion([], ajeno);
    await escucha.recargar();
    check('mientras dura, ni recargar se lo quita a quien lo reservo', falso.callback === ajeno);
    await reserva.soltar();
    await reserva.soltar();
    check('soltar dos veces no descuenta dos reservas', escucha._estado().reservas === 0);
    check('al soltarla el kiosco lo recupera', falso.callback !== ajeno && typeof falso.callback === 'function');

    // ---------------------- si el sidecar se cae, el vigilante lo rearma
    // (se llama al mismo paso que hace el reloj, sin esperar sus 30 s)
    falso.abierto = false;
    falso.callback = null;
    const cargasAntesCaida = falso.cargas.length;
    // Lo que hace el reloj del vigilante: armado pero sin conexion -> rearmar.
    escucha._vigilarAhora();
    await espera(50);
    check('si el sidecar se cayo, el vigilante vuelve a armar el lector',
          falso.cargas.length === cargasAntesCaida + 1 && typeof falso.callback === 'function');
    falso.abierto = true;

    // ------------------------- cerrar la segunda pantalla sin desmontar nada
    segunda.cerrar();
    await espera(50);
    check('cerrar la ventana la borra sola y el lector se desarma', falso.callback === null
          && escucha._estado().oyentes === 0, JSON.stringify(escucha._estado()));

    await huella(camila);
    check('sin kioscos abiertos un dedo no registra nada', asistenciasDe(camila) === 1);
  } catch (e) {
    log('FALLA excepcion: ' + (e && e.stack || e));
    fallos++;
  }

  log('');
  log(fallos === 0 ? 'TODO OK' : 'FALLOS: ' + fallos);
  volcar();
  app.exit(fallos === 0 ? 0 : 1);
});
