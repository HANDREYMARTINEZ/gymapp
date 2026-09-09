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
    const sufijo = `antes-de-restaurar-${Date.now()}`;
    // El -wal y el -shm pertenecen a la base que estamos reemplazando. Si se
    // quedan aqui, SQLite abriria la base restaurada contra el WAL de la
    // anterior y la corromperia. Se mueven junto con ella, no se borran: asi
    // el respaldo de seguridad sigue siendo una base completa y restaurable.
    for (const sidecar of ['', '-wal', '-shm']) {
      const origen = dbPath + sidecar;
      if (fs.existsSync(origen)) {
        fs.renameSync(origen, path.join(userDataPath, `gym.db.${sufijo}${sidecar}`));
      }
    }
    console.log('Respaldo de seguridad del gym.db anterior guardado con sufijo:', sufijo);
  }

  fs.renameSync(rutaPendiente, dbPath);
  fs.unlinkSync(rutaFlag);
  console.log('Restauración aplicada correctamente.');
}

// Reset de fabrica del panel de desarrollador. Corre antes de abrir nada, por lo
// mismo que la restauracion: con la base ya abierta, Windows no deja moverla.
//
// La base NO se borra, se aparta con un nombre que dice de que es. Un reset se
// pide con la certeza de que sobra, y esa certeza se equivoca de vez en cuando;
// la copia apartada es la unica vuelta atras, porque los respaldos viejos se
// cifraron con la DEK anterior y despues del reset ya no hay quien los abra.
// Del panel se pueden borrar despues, cuando ya no haga falta.
function aplicarResetPendiente() {
  const userDataPath = app.getPath('userData');
  const rutaFlag = path.join(userDataPath, 'reset-pendiente.flag');
  if (!fs.existsSync(rutaFlag)) return;

  const dbPath = path.join(userDataPath, 'gym.db');
  const sufijo = `antes-de-reset-${Date.now()}`;

  // El -wal y el -shm se mueven con ella: dejarlos aqui haria que SQLite abriera
  // la base nueva contra el WAL de la vieja y la corrompiera.
  for (const sidecar of ['', '-wal', '-shm']) {
    const origen = dbPath + sidecar;
    if (fs.existsSync(origen)) {
      fs.renameSync(origen, path.join(userDataPath, `gym.db.${sufijo}${sidecar}`));
    }
  }

  fs.unlinkSync(rutaFlag);
  console.log('Reset de fábrica aplicado. La base anterior quedó como gym.db.' + sufijo);
}

function conectar() {
  aplicarRestauracionPendiente();
  aplicarResetPendiente();

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