const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let db;

function aplicarRestauracionPendiente() {
  const userDataPath = app.getPath('userData');
  const rutaFlag = path.join(userDataPath, 'restore-pendiente.flag');
  if (!fs.existsSync(rutaFlag)) return;

  const rutaPendiente = fs.readFileSync(rutaFlag, 'utf-8');
  const dbPath = path.join(userDataPath, 'gym.db');

  if (fs.existsSync(dbPath)) {
    const respaldoSeguridad = path.join(userDataPath, `gym.db.antes-de-restaurar-${Date.now()}`);
    fs.renameSync(dbPath, respaldoSeguridad);
    console.log('Respaldo de seguridad del gym.db anterior guardado en:', respaldoSeguridad);
  }

  fs.renameSync(rutaPendiente, dbPath);
  fs.unlinkSync(rutaFlag);
  console.log('Restauración aplicada correctamente.');
}

function conectar() {
  aplicarRestauracionPendiente();

  const dbPath = path.join(app.getPath('userData'), 'gym.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ejecutarMigraciones();
  console.log('Base de datos en:', dbPath);
  return db;
}

function ejecutarMigraciones() {
  db.exec(`CREATE TABLE IF NOT EXISTS _migraciones (nombre TEXT PRIMARY KEY, aplicada_en TEXT)`);
  const migracionesDir = path.join(__dirname, 'migrations');
  const archivos = fs.readdirSync(migracionesDir).sort();
  for (const archivo of archivos) {
    const yaAplicada = db.prepare(`SELECT 1 FROM _migraciones WHERE nombre = ?`).get(archivo);
    if (yaAplicada) continue;
    const sql = fs.readFileSync(path.join(migracionesDir, archivo), 'utf-8');
    db.exec(sql);
    db.prepare(`INSERT INTO _migraciones (nombre, aplicada_en) VALUES (?, ?)`).run(archivo, new Date().toISOString());
    console.log(`Migración aplicada: ${archivo}`);
  }
}

function getDb() {
  if (!db) throw new Error('DB no inicializada — llama conectar() primero');
  return db;
}

module.exports = { conectar, getDb };