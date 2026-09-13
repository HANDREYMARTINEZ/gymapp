// Suite de la puerta automatica.
//
// Lo que se puede comprobar sin tener el Arduino enchufado es casi todo lo que
// importa, porque lo que importa no es que la puerta abra: es QUE NO ABRA
// cuando no debe, y que el kiosco siga funcionando cuando el cacharro no esta.
//
// Lo unico que necesita hardware es el pulso de verdad, y para eso esta
// `npm run puerta -- --abrir`.

const { app, ipcMain, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-puerta-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-puerta-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const handlers = {};
const registrarOriginal = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (canal, fn) => { handlers[canal] = fn; registrarOriginal(canal, fn); };

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
    const clientes = require('../electron/db/repos/clientes');
    const membresias = require('../electron/db/repos/membresias');
    const planes = require('../electron/db/repos/planes');
    const caja = require('../electron/db/repos/caja');
    const puerta = require('../electron/services/puerta');
    require('../electron/ipc/puerta');
    require('../electron/ipc/kiosco');
    require('../electron/ipc/clientes');

    dekMod.guardarDekEnMemoria(dekMod.generarDEK());
    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Cajero', 'cajero', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;
    caja.abrir({ usuarioId, baseInicial: 100000 });

    const leerConfig = (c) => {
      const f = db.prepare('SELECT valor FROM config WHERE clave = ?').get(c);
      return f ? f.valor : null;
    };

    // ------------------------------------------------------------ el modulo
    //
    // serialport trae binario nativo. El dia que una actualizacion de electron
    // lo rompa, la puerta dejaria de abrir EN SILENCIO -- la app arranca igual
    // porque la carga va envuelta en try. Esta comprobacion es el unico sitio
    // donde eso sale a la luz antes de que pase en el gimnasio.
    const e0 = puerta.estado();
    check('el modulo nativo del puerto serie carga', e0.moduloOk === true, e0.moduloFallo || '');

    // ------------------------------------------------------- por defecto, no
    //
    // Recien instalada la app no tiene puerta. Si el valor por defecto fuera
    // "activa", cualquier gimnasio sin Arduino veria fallos en cada entrada.
    check('de fabrica la puerta viene desactivada', e0.activa === false);
    check('de fabrica no hay puerto elegido', !e0.puerto, String(e0.puerto));
    check('de fabrica son 5 segundos', e0.segundos === 5, String(e0.segundos));
    check('de fabrica no hay conexion', e0.conectada === false);

    check('desactivada, el kiosco no intenta abrir nada',
          (await puerta.abrirSiProcede()) === 'desactivada');

    // Sin puerto elegido contesta enseguida y con un motivo que se entiende, en
    // vez de ponerse a sondear COM con un cliente delante.
    const sinPuerto = await puerta.pulso();
    check('sin puerto elegido, el pulso falla con sin_puerto',
          sinPuerto.ok === false && sinPuerto.motivo === 'sin_puerto', sinPuerto.motivo);

    // ---------------------------------------------- hay una placa de verdad?
    //
    // Se mira AQUI, y no mas abajo donde hace falta, porque es el unico momento
    // en que la respuesta es fiable: todavia no se ha guardado ninguna
    // configuracion, asi que no hay ninguna reconexion en segundo plano
    // ocupando el puerto. Preguntandolo mas tarde daba 'no hay placa' cuando si
    // la habia, simplemente porque el COM estaba cogido por la propia app.
    const hayPlacaReal = await puerta.detectar(true);
    if (hayPlacaReal.ok) {
      log('NOTA  hay una placa de verdad en ' + hayPlacaReal.puerto);
    }

    // ------------------------------------------------------- los segundos
    for (const malo of [0, -1, 16, 999, 'abc', null]) {
      const r = await handlers['puerta:guardar'](null, { activa: false, puerto: 'COM3', segundos: malo });
      check('rechaza ' + JSON.stringify(malo) + ' segundos', r.ok === false && r.motivo === 'segundos_invalidos');
    }
    check('un valor rechazado no deja nada escrito', leerConfig('puerta_segundos') === null);

    for (const bueno of [1, 5, 15]) {
      const r = await handlers['puerta:guardar'](null, { activa: false, puerto: 'COM7', segundos: bueno });
      check('acepta ' + bueno + ' segundos', r.ok === true && leerConfig('puerta_segundos') === String(bueno));
    }

    const guardado = await handlers['puerta:guardar'](null, { activa: true, puerto: 'COM198', segundos: 7 });
    check('guarda las tres cosas a la vez',
          guardado.ok === true &&
          leerConfig('puerta_activa') === '1' &&
          leerConfig('puerta_puerto') === 'COM198' &&
          leerConfig('puerta_segundos') === '7');

    const e1 = puerta.estado();
    check('el estado refleja lo guardado',
          e1.activa === true && e1.puerto === 'COM198' && e1.segundos === 7);

    // El tope de arriba se aplica tambien al leer, no solo al guardar: si
    // alguien mete un 900 en la tabla config a mano, la puerta no se queda
    // suelta quince minutos.
    db.prepare(`UPDATE config SET valor = '900' WHERE clave = 'puerta_segundos'`).run();
    check('un valor absurdo en la base se recorta al leerlo', puerta.estado().segundos === 15);
    db.prepare(`UPDATE config SET valor = '7' WHERE clave = 'puerta_segundos'`).run();

    // ------------------------------------------------------------ inventario
    const puertos = await puerta.listarPuertos();
    check('listar puertos devuelve una lista y no revienta', Array.isArray(puertos),
          puertos.length + ' puerto(s)');
    check('cada puerto viene con su nombre y si es FTDI',
          puertos.every(p => typeof p.puerto === 'string' && typeof p.esFtdi === 'boolean'));

    // ------------------------------------------------- el enganche del kiosco
    //
    // Esta es la parte que de verdad importa: que la puerta siga exactamente la
    // misma regla que la asistencia, y ni una mas.
    const { respuestaKiosco } = require('../electron/ipc/kiosco');

    // Desactivada a proposito: asi la etiqueta que llega a la pantalla es
    // 'desactivada' y no depende de si esta maquina tiene o no un COM libre.
    await handlers['puerta:guardar'](null, { activa: false, puerto: '', segundos: 5 });

    const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 70000, dias_duracion: 30 });

    const alDia = clientes.crear({ documento: '9900013910', nombre: 'Vigente Vigente', telefono: '300' });
    const mVigente = membresias.vender({ clienteId: alDia, planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: mVigente, monto: 70000, metodo: 'Efectivo', usuarioId });

    const debiendo = clientes.crear({ documento: '2000004321', nombre: 'Debe Saldo', telefono: '301' });
    membresias.vender({ clienteId: debiendo, planId: mensual, usuarioId }); // sin pagar

    const sinNada = clientes.crear({ documento: '3000004321', nombre: 'Sin Membresia', telefono: '302' });

    const asistencias = require('../electron/db/repos/asistencias');

    const entra = await respuestaKiosco(
      asistencias.registrar({ clienteId: alDia, metodo: 'pin', registradoPor: null }), alDia);
    check('quien puede entrenar pasa por el camino de la puerta',
          entra.ok === true && entra.puerta === 'desactivada', String(entra.puerta));

    // Con la puerta desactivada la etiqueta es 'desactivada'; lo que se
    // comprueba aqui es que el rechazado NI SIQUIERA llega a preguntar.
    const conSaldo = await respuestaKiosco(
      asistencias.registrar({ clienteId: debiendo, metodo: 'pin', registradoPor: null }), debiendo);
    check('al que debe no se le abre la puerta',
          conSaldo.ok === false && conSaldo.puerta === undefined,
          conSaldo.motivo + '/' + String(conSaldo.puerta));

    const nada = await respuestaKiosco(
      asistencias.registrar({ clienteId: sinNada, metodo: 'pin', registradoPor: null }), sinNada);
    check('al que no tiene membresia no se le abre la puerta',
          nada.ok === false && nada.motivo === 'sin_membresia' && nada.puerta === undefined);

    // ------------------------------------------------------------ reingreso
    //
    // Decision de Andrey del 12-sep: quien ya marco hoy y sale (al carro, a la
    // tienda) tiene que poder volver a entrar, con PIN o con huella. Antes esta
    // prueba decia lo contrario -- "marcar dos veces no vuelve a abrir" -- y era
    // lo que dejaba a la gente fuera.
    //
    // Lo que NO puede hacer un reingreso: crear otra asistencia, gastar otro
    // tiquete, o abrir cuando recepcion anulo o pauso la membresia despues.
    const nAsis = (id) => db.prepare('SELECT COUNT(*) n FROM asistencias WHERE cliente_id = ?').get(id).n;
    const nReingresos = (id) => db.prepare(
      "SELECT COUNT(*) n FROM auditoria WHERE accion = 'kiosco_reingreso' AND entidad_id = ?").get(id).n;

    // Con el nombre dentro, como hacen los dos caminos de verdad (kiosco:marcarPorPin
    // y la huella) antes de llamar a respuestaKiosco.
    const repetido = await respuestaKiosco(
      { ...asistencias.registrar({ clienteId: alDia, metodo: 'pin', registradoPor: null }), nombre: 'Vigente Vigente' },
      alDia, 'pin');
    check('quien ya vino hoy y vuelve, entra: es un reingreso',
          repetido.ok === true && repetido.reingreso === true && repetido.puerta === 'desactivada',
          JSON.stringify({ ok: repetido.ok, reingreso: repetido.reingreso, puerta: repetido.puerta, motivo: repetido.motivo }));
    check('el reingreso no crea otra asistencia', nAsis(alDia) === 1, 'asistencias=' + nAsis(alDia));
    check('trae la foto y el nombre, igual que la entrada normal',
          repetido.nombre === 'Vigente Vigente' && repetido.clienteId === alDia);

    await respuestaKiosco(
      asistencias.registrar({ clienteId: alDia, metodo: 'huella', registradoPor: null }), alDia, 'huella');
    check('tambien con huella, y las veces que haga falta', nAsis(alDia) === 1);
    check('cada reingreso queda anotado en auditoria', nReingresos(alDia) === 2, 'anotados=' + nReingresos(alDia));
    const anotado = JSON.parse(db.prepare(
      "SELECT detalle FROM auditoria WHERE accion = 'kiosco_reingreso' AND entidad_id = ? ORDER BY id DESC").get(alDia).detalle);
    check('con el metodo y el estado de la puerta', anotado.metodo === 'huella' && anotado.puerta === 'desactivada',
          JSON.stringify(anotado));

    // Ultimo tiquete gastado hoy: la tiquetera queda 'agotada', pero el tiquete
    // de hoy cubre el dia entero (decision de Andrey).
    const unTiquete = planes.crear({ nombre: 'Un tiquete', tipo: 'ticketera', precio: 8000, num_tickets: 1, dias_vigencia: 30 });
    const ultimo = clientes.crear({ documento: '6000004321', nombre: 'Ultimo Tiquete', telefono: '304' });
    const mUltimo = membresias.vender({ clienteId: ultimo, planId: unTiquete, usuarioId });
    membresias.registrarPago({ membresiaId: mUltimo, monto: 8000, metodo: 'Efectivo', usuarioId });
    const usadosUltimo = () => db.prepare('SELECT tickets_usados u FROM membresias WHERE id = ?').get(mUltimo).u;

    const entraUltimo = await respuestaKiosco(
      asistencias.registrar({ clienteId: ultimo, metodo: 'pin', registradoPor: null }), ultimo, 'pin');
    check('gasta su ultimo tiquete y entra', entraUltimo.ok === true && !entraUltimo.reingreso && usadosUltimo() === 1);
    const vuelveUltimo = await respuestaKiosco(
      asistencias.registrar({ clienteId: ultimo, metodo: 'pin', registradoPor: null }), ultimo, 'pin');
    check('con la tiquetera ya agotada, vuelve a entrar hoy',
          vuelveUltimo.ok === true && vuelveUltimo.reingreso === true,
          JSON.stringify({ ok: vuelveUltimo.ok, motivo: vuelveUltimo.motivo }));
    check('y no gasta un tiquete que ya no tiene', usadosUltimo() === 1 && nAsis(ultimo) === 1,
          'usados=' + usadosUltimo() + ' asistencias=' + nAsis(ultimo));

    // Recepcion la pausa despues de que entrara: ya no vuelve a entrar, y se le
    // dice el motivo real, no "ya registraste tu asistencia".
    const pausado = clientes.crear({ documento: '7000004321', nombre: 'Luego Pausado', telefono: '305' });
    const mPausado = membresias.vender({ clienteId: pausado, planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: mPausado, monto: 70000, metodo: 'Efectivo', usuarioId });
    await respuestaKiosco(asistencias.registrar({ clienteId: pausado, metodo: 'pin', registradoPor: null }), pausado, 'pin');
    require('../electron/db/repos/pausas').pausar({ membresiaId: mPausado, motivo: 'viaje', usuarioId });
    const vuelvePausado = await respuestaKiosco(
      asistencias.registrar({ clienteId: pausado, metodo: 'pin', registradoPor: null }), pausado, 'pin');
    check('pausada despues de entrar: no vuelve a entrar',
          vuelvePausado.ok === false && vuelvePausado.puerta === undefined && vuelvePausado.motivo === 'pausada',
          JSON.stringify({ ok: vuelvePausado.ok, motivo: vuelvePausado.motivo }));
    check('y un reingreso negado no se anota como reingreso', nReingresos(pausado) === 0);

    const anulado = clientes.crear({ documento: '8000004321', nombre: 'Luego Anulado', telefono: '306' });
    const mAnulado = membresias.vender({ clienteId: anulado, planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: mAnulado, monto: 70000, metodo: 'Efectivo', usuarioId });
    await respuestaKiosco(asistencias.registrar({ clienteId: anulado, metodo: 'pin', registradoPor: null }), anulado, 'pin');
    const anulo = membresias.anular({ membresiaId: mAnulado, usuarioId, motivo: 'prueba' });
    const vuelveAnulado = await respuestaKiosco(
      asistencias.registrar({ clienteId: anulado, metodo: 'pin', registradoPor: null }), anulado, 'pin');
    check('anulada despues de entrar: no vuelve a entrar',
          anulo.ok === true && vuelveAnulado.ok === false && vuelveAnulado.puerta === undefined &&
          vuelveAnulado.motivo === 'anulada',
          JSON.stringify({ anulo: anulo.ok, ok: vuelveAnulado.ok, motivo: vuelveAnulado.motivo }));

    // ------------------------------------------- la puerta no rompe el kiosco
    //
    // Con la puerta ACTIVADA y rota, la asistencia se tiene que registrar igual.
    // Es el escenario real del dia que alguien desenchufe el USB sin avisar.
    //
    // CUIDADO AL TOCAR ESTO. Hay dos formas de "rota" y no dan igual:
    //
    //   - apuntando a un COM que no existe, pulso() hace lo que debe hacer en
    //     produccion: buscar la placa por los puertos FTDI y, si la encuentra,
    //     ABRIRLA. Con el electroiman ya instalado, eso significa que correr
    //     `npm test` abriria la puerta de la calle.
    //   - sin puerto elegido, contesta en el acto y no sonda nada.
    //
    // Asi que se mira primero si hay una placa de verdad enchufada. La propiedad
    // que se comprueba -- que la asistencia entra igual y el kiosco no se cuelga
    // -- es la misma por los dos caminos.
    await handlers['puerta:guardar'](null, {
      activa: true,
      puerto: hayPlacaReal.ok ? '' : 'COM199',
      segundos: 5,
    });
    const otro = clientes.crear({ documento: '4000004321', nombre: 'Otro Vigente', telefono: '303' });
    const mOtro = membresias.vender({ clienteId: otro, planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: mOtro, monto: 70000, metodo: 'Efectivo', usuarioId });

    const antes = Date.now();
    const conPuertaRota = await respuestaKiosco(
      asistencias.registrar({ clienteId: otro, metodo: 'pin', registradoPor: null }), otro);
    const tardo = Date.now() - antes;

    check('con la puerta rota la asistencia se registra igual', conPuertaRota.ok === true);
    check('y queda escrita en la tabla',
          db.prepare('SELECT COUNT(*) AS n FROM asistencias WHERE cliente_id = ?').get(otro).n === 1);
    check('y el kiosco no se queda colgado esperandola',
          tardo < 2500, tardo + ' ms');
    check('y avisa de que la puerta no abrio',
          conPuertaRota.puerta === 'fallo' || conPuertaRota.puerta === 'abriendo',
          String(conPuertaRota.puerta));

    await puerta.cerrar();
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
