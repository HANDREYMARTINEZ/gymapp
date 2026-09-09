const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-desbloqueo-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-desbloqueo-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

// Los handlers de IPC son la frontera real que usa la pantalla de Desbloqueo, y
// el error que motivo esta prueba vivia justo ahi: setup guardaba el escrow bajo
// un nombre de fila y desbloqueo lo leia bajo otro. Probar los repos por dentro
// no lo habria visto. Se interceptan los handlers al registrarse para poder
// llamarlos igual que los llama el renderer.
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

    require('../electron/ipc/setup');
    require('../electron/ipc/desbloqueo');

    check('setup y desbloqueo registran sus handlers',
          !!handlers['setup:finalizar'] && !!handlers['desbloqueo:intentar'] && !!handlers['desbloqueo:dev']);

    const PASSPHRASE = 'passphrase-de-prueba';
    await handlers['setup:finalizar'](null, PASSPHRASE);

    const getConfig = (clave) => {
      const row = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
      return row ? row.valor : null;
    };

    // --- passphrase normal ---
    check('setup guarda el salt y la DEK envuelta con la passphrase',
          !!getConfig('kdf_salt') && !!getConfig('dek_wrapped_user'));
    check('setup guarda tambien la copia de escrow del desarrollador',
          !!getConfig('dek_wrapped_recovery'));

    const buena = await handlers['desbloqueo:intentar'](null, PASSPHRASE);
    check('la passphrase correcta desbloquea', buena.ok === true);
    check('y deja la DEK en memoria',
          (await handlers['desbloqueo:estaDesbloqueado']()) === true);

    const mala = await handlers['desbloqueo:intentar'](null, 'no-es-la-passphrase');
    check('la passphrase equivocada no desbloquea', mala.ok === false);
    check('y lo dice sin filtrar el error de cifrado',
          mala.error === 'Passphrase incorrecta', 'error=' + mala.error);

    // --- acceso de desarrollador (Ctrl+Alt+D) ---
    //
    // La clave privada real del desarrollador no vive en el repositorio, asi que
    // la prueba genera su propio par y reescribe la fila de escrow con el. Lo que
    // se comprueba es el circuito -- que desbloqueo lea la fila que setup escribe
    // y sepa desenvolverla -- no la clave concreta.
    const par = crypto.generateKeyPairSync('x25519');
    const publicaPem = par.publicKey.export({ type: 'spki', format: 'pem' });
    const privadaPem = par.privateKey.export({ type: 'pkcs8', format: 'pem' });

    const dekReal = dekMod.desenvolverDEK(
      getConfig('dek_wrapped_user'),
      await dekMod.derivarKEK(PASSPHRASE, getConfig('kdf_salt'))
    );

    db.prepare(`INSERT INTO config (clave, valor) VALUES ('dek_wrapped_recovery', ?)
                ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`)
      .run(dekMod.envolverDEKConClavePublica(dekReal, publicaPem));

    const dev = await handlers['desbloqueo:dev'](null, privadaPem);
    check('la clave privada del desarrollador desbloquea', dev.ok === true,
          'error=' + (dev.error || 'ninguno'));

    const otro = crypto.generateKeyPairSync('x25519');
    const devMalo = await handlers['desbloqueo:dev'](
      null, otro.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    check('una clave privada que no es la del escrow no desbloquea', devMalo.ok === false);
    check('y lo dice sin filtrar el error de cifrado',
          devMalo.error === 'Clave privada inválida', 'error=' + devMalo.error);

    check('la basura pegada en el recuadro no tumba la app',
          (await handlers['desbloqueo:dev'](null, 'esto no es un PEM')).ok === false);

    // --- sin escrow guardado ---
    db.prepare(`DELETE FROM config WHERE clave = 'dek_wrapped_recovery'`).run();
    const sinEscrow = await handlers['desbloqueo:dev'](null, privadaPem);
    check('sin fila de escrow avisa que no la hay',
          sinEscrow.ok === false && sinEscrow.error === 'No hay clave de escrow guardada',
          'error=' + sinEscrow.error);

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
