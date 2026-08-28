const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-wal-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-wal-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const { conectar, getDb } = require('../electron/db/connection');
    const dek = require('../electron/crypto/dek');
    const backup = require('../electron/services/backup');
    const AdmZip = require('adm-zip');
    const Database = require('better-sqlite3');

    conectar();
    const db = getDb();

    const marca = 'marca-' + Date.now();
    db.prepare("INSERT INTO config (clave, valor) VALUES ('prueba_wal', ?)").run(marca);

    const dbPath = path.join(testDir, 'gym.db');
    const walPath = dbPath + '-wal';
    const walBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    check('el WAL tiene contenido sin checkpoint', walBytes > 0, walBytes + ' bytes');

    const copiaCruda = path.join(testDir, 'copia-cruda.db');
    fs.copyFileSync(dbPath, copiaCruda);
    let enCopiaCruda = null;
    try {
      const dbCrudo = new Database(copiaCruda, { readonly: true });
      const row = dbCrudo.prepare("SELECT valor FROM config WHERE clave='prueba_wal'").get();
      enCopiaCruda = row ? row.valor : null;
      dbCrudo.close();
    } catch (e) { enCopiaCruda = 'ERROR: ' + e.message; }
    check('copiar gym.db a secas PIERDE el dato (bug reproducido)',
          enCopiaCruda !== marca, 'leyo: ' + enCopiaCruda);

    dek.guardarDekEnMemoria(dek.generarDEK());
    const r = await backup.generarRespaldo();
    check('generarRespaldo devuelve ok', r.ok === true);
    check('el .gymbak existe', fs.existsSync(r.ruta));

    const cifrado = fs.readFileSync(r.ruta, 'utf-8');
    const zipBuffer = dek.descifrarBuffer(cifrado, dek.obtenerDekEnMemoria());
    const entrada = new AdmZip(zipBuffer).getEntry('gym.db');
    check('el zip contiene gym.db', !!entrada);

    const restaurada = path.join(testDir, 'desde-respaldo.db');
    fs.writeFileSync(restaurada, entrada.getData());
    const dbR = new Database(restaurada, { readonly: true });
    const row = dbR.prepare("SELECT valor FROM config WHERE clave='prueba_wal'").get();
    dbR.close();
    check('el RESPALDO si contiene el dato del WAL', row && row.valor === marca,
          'leyo: ' + (row ? row.valor : 'null'));

    const sobrantes = fs.readdirSync(app.getPath('temp')).filter(f => f.startsWith('gym-snapshot-'));
    check('no quedan snapshots temporales', sobrantes.length === 0, sobrantes.join(','));

    db.close();
  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (e) {
    // Windows mantiene el lock un instante tras cerrar SQLite. No es un fallo
    // de la prueba: el temporal queda y el SO lo recicla.
  }
  app.exit(fallos === 0 ? 0 : 1);
});
