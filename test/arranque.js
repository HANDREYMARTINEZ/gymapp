const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-arranque-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-arranque-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

// Los handlers son la frontera real que usa la pantalla de Login.
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
    // SQLite no casa 'texto' || ? cuando el parametro es un entero, asi que la
    // clave se arma aqui igual que la arma el servicio.
    const llaveDe = (id) => 'dek_usuario_' + id;
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();
    const dekMod = require('../electron/crypto/dek');
    const usuarios = require('../electron/db/repos/usuarios');
    const imagenes = require('../electron/services/imagenes');

    require('../electron/ipc/setup');
    require('../electron/ipc/auth');

    const PASSPHRASE = 'la-passphrase-del-gimnasio';

    // ---- Se reproduce una instalacion que ya existia antes del cambio: el
    //      wizard creo el admin y luego la passphrase, y no hay ninguna llave
    //      por usuario. Es la situacion exacta de la maquina de Andrey.
    const admin = await usuarios.crear({ nombre: 'Andrey', usuario: 'andrey', password: 'clave1234', rol: 'admin' });
    await handlers['setup:finalizar'](null, PASSPHRASE);
    dekMod.guardarDekEnMemoria(null);

    check('una instalacion vieja no tiene llave para su usuario',
          !db.prepare(`SELECT 1 FROM config WHERE clave = ?`).get(llaveDe(admin.id)));

    // ---- Primer login tras el cambio ----
    const malo = await handlers['auth:login'](null, 'andrey', 'no-es-mi-clave');
    check('la contrasena equivocada no entra', malo.ok === false);

    const primero = await handlers['auth:login'](null, 'andrey', 'clave1234');
    check('la contrasena buena entra', primero.ok === true);
    check('pero avisa de que hace falta la passphrase una vez',
          primero.necesitaPassphrase === true);
    check('y todavia no abrio el cifrado', dekMod.obtenerDekEnMemoria() === null);

    const mala = await handlers['auth:vincularPassphrase'](null,
      { usuario: 'andrey', password: 'clave1234', passphrase: 'no-es' });
    check('una passphrase equivocada no engancha nada',
          mala.ok === false && mala.motivo === 'passphrase_incorrecta');
    check('ni deja el cifrado abierto por error', dekMod.obtenerDekEnMemoria() === null);

    const enganche = await handlers['auth:vincularPassphrase'](null,
      { usuario: 'andrey', password: 'clave1234', passphrase: PASSPHRASE });
    check('con la passphrase correcta engancha', enganche.ok === true, 'motivo=' + enganche.motivo);
    check('y deja el cifrado abierto', dekMod.obtenerDekEnMemoria() !== null);
    const dekReal = dekMod.obtenerDekEnMemoria();

    // ---- A partir de aqui, la passphrase no se vuelve a pedir ----
    dekMod.guardarDekEnMemoria(null);
    const segundo = await handlers['auth:login'](null, 'andrey', 'clave1234');
    check('el segundo login ya NO pide la passphrase', !segundo.necesitaPassphrase);
    check('y abre el cifrado el solo', dekMod.obtenerDekEnMemoria() !== null);
    check('es la misma DEK, no una nueva',
          dekMod.obtenerDekEnMemoria().equals(dekReal));

    // Que sea la misma importa de verdad: con otra, las huellas y las fotos ya
    // guardadas dejarian de descifrarse.
    imagenes.guardar({ entidad: 'gimnasio', base64: Buffer.alloc(0).toString('base64') });
    const guardada = await handlers['auth:login'](null, 'ANDREY', 'clave1234');
    check('el usuario tambien entra escrito en mayusculas', guardada.ok === true);

    // ---- La llave no esta en claro en ningun sitio ----
    const fila = db.prepare(`SELECT valor FROM config WHERE clave = ?`).get(llaveDe(admin.id)).valor;
    check('la llave guardada no contiene la DEK en claro',
          !fila.includes(dekReal.toString('hex')));
    check('ni la contrasena', !fila.toLowerCase().includes('clave1234'));

    // ---- Usuario nuevo creado desde dentro: ya nace enganchado ----
    const laura = await usuarios.crear({ nombre: 'Laura', usuario: 'laura', password: 'otraclave', rol: 'asistente' });
    dekMod.guardarDekEnMemoria(null);
    const deLaura = await handlers['auth:login'](null, 'laura', 'otraclave');
    check('un usuario creado desde dentro no tiene que pedir la passphrase',
          deLaura.ok === true && !deLaura.necesitaPassphrase);
    check('y abre la misma DEK', dekMod.obtenerDekEnMemoria().equals(dekReal));

    check('cada usuario tiene su propia envoltura, no una compartida',
          db.prepare(`SELECT valor FROM config WHERE clave = ?`).get(llaveDe(admin.id)).valor
            !== db.prepare(`SELECT valor FROM config WHERE clave = ?`).get(llaveDe(laura.id)).valor);

    // ---- Cambiar la contrasena rehace la llave ----
    await usuarios.cambiarPassword({ id: laura.id, password: 'clave-nueva' });
    dekMod.guardarDekEnMemoria(null);
    check('con la contrasena vieja ya no entra',
          (await handlers['auth:login'](null, 'laura', 'otraclave')).ok === false);
    const conNueva = await handlers['auth:login'](null, 'laura', 'clave-nueva');
    check('con la nueva entra y sigue sin pedir passphrase',
          conNueva.ok === true && !conNueva.necesitaPassphrase);
    check('y abre la misma DEK de siempre', dekMod.obtenerDekEnMemoria().equals(dekReal));

    // Si le cambian la contrasena con la base cerrada, no puede quedarse una
    // llave que no abre: tiene que volver a pedir la passphrase, no dejarle fuera.
    dekMod.guardarDekEnMemoria(null);
    await usuarios.cambiarPassword({ id: laura.id, password: 'tercera-clave' });
    const trasCierre = await handlers['auth:login'](null, 'laura', 'tercera-clave');
    check('si le cambian la clave con la base cerrada, vuelve a pedir la passphrase una vez',
          trasCierre.ok === true && trasCierre.necesitaPassphrase === true);
    check('y con ella recupera el acceso',
          (await handlers['auth:vincularPassphrase'](null,
            { usuario: 'laura', password: 'tercera-clave', passphrase: PASSPHRASE })).ok === true);

    // ---- Acceso de desarrollador ----
    dekMod.guardarDekEnMemoria(null);
    const devMalo = await handlers['auth:accesoDesarrollador'](null, 'lo-que-sea');
    check('el acceso de desarrollador rechaza una passphrase mala',
          devMalo.ok === false && devMalo.motivo === 'passphrase_incorrecta');
    check('y no abre el cifrado', dekMod.obtenerDekEnMemoria() === null);

    const dev = await handlers['auth:accesoDesarrollador'](null, PASSPHRASE);
    check('con la passphrase correcta entra', dev.ok === true);
    check('marcado como desarrollador', dev.usuario.desarrollador === true);
    check('y abre el cifrado', dekMod.obtenerDekEnMemoria().equals(dekReal));
    check('entra con su propia cuenta, no con la de un admin real',
          dev.usuario.usuario === 'desarrollador' && dev.usuario.id !== admin.id,
          'usuario=' + dev.usuario.usuario);
    check('esa cuenta queda inactiva, para que nadie entre por el login normal',
          db.prepare(`SELECT activo FROM usuarios WHERE usuario = 'desarrollador'`).get().activo === 0);
    check('y por el login normal no entra',
          (await handlers['auth:login'](null, 'desarrollador', PASSPHRASE)).ok === false);
    check('el acceso queda en auditoria',
          !!db.prepare(`SELECT 1 FROM auditoria WHERE accion = 'acceso_desarrollador'`).get());

    const dev2 = await handlers['auth:accesoDesarrollador'](null, PASSPHRASE);
    check('entrar dos veces no duplica la cuenta',
          db.prepare(`SELECT COUNT(*) AS n FROM usuarios WHERE usuario = 'desarrollador'`).get().n === 1
          && dev2.ok === true);

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
