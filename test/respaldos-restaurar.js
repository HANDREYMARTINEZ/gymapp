const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-restaurar-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-restaurar-' + Date.now());
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
    const dek = require('../electron/crypto/dek');
    const backup = require('../electron/services/backup');

    dek.guardarDekEnMemoria(dek.generarDEK());

    // --- Sesion 1: estado A, se respalda ---
    conn.conectar();
    conn.getDb().prepare("INSERT INTO config (clave, valor) VALUES ('estado', 'A')").run();
    const r = await backup.generarRespaldo();
    check('respaldo del estado A generado', r.ok === true);

    // --- Se sigue trabajando: estado B, que NO esta en el respaldo ---
    conn.getDb().prepare("UPDATE config SET valor = 'B' WHERE clave = 'estado'").run();
    conn.getDb().prepare("INSERT INTO config (clave, valor) VALUES ('solo_en_B', '1')").run();
    const leidoAntes = conn.getDb().prepare("SELECT valor FROM config WHERE clave='estado'").get();
    check('la base viva esta en estado B', leidoAntes.valor === 'B');

    const dbPath = path.join(testDir, 'gym.db');
    check('existe un gym.db-wal de la sesion B', fs.existsSync(dbPath + '-wal'));

    // --- Restaurar: deja el .restored y el flag, la app se relanzaria aqui ---
    const res = backup.restaurarRespaldo(r.ruta);
    check('restaurarRespaldo pide reiniciar', res.requiereReiniciar === true);
    conn.getDb().close();

    // --- Sesion 2: el arranque aplica la restauracion pendiente ---
    conn.conectar();
    const leidoDespues = conn.getDb().prepare("SELECT valor FROM config WHERE clave='estado'").get();
    check('tras restaurar, la base vuelve al estado A',
          leidoDespues && leidoDespues.valor === 'A',
          'leyo: ' + (leidoDespues ? leidoDespues.valor : 'null'));

    const soloB = conn.getDb().prepare("SELECT valor FROM config WHERE clave='solo_en_B'").get();
    check('lo escrito despues del respaldo ya no esta', !soloB,
          soloB ? 'quedo: ' + soloB.valor : 'ausente, correcto');

    const seguridad1 = fs.readdirSync(testDir).filter(f => f.startsWith('gym.db.antes-de-restaurar-'));
    check('se guardo el respaldo de seguridad de la base anterior', seguridad1.length > 0,
          seguridad1.join(', '));

    check('no quedo flag de restauracion pendiente',
          !fs.existsSync(path.join(testDir, 'restore-pendiente.flag')));
    check('no quedo el archivo .restored',
          !fs.existsSync(path.join(testDir, 'gym.db.restored')));

    // --- Escenario 2: el nucleo del arreglo ---
    // Al cerrar SQLite limpiamente se hace checkpoint y el -wal se borra solo,
    // asi que el escenario 1 nunca lo ejercita. El -wal solo sobrevive tras un
    // cierre abrupto (corte de luz, cuelgue). Se simula plantando uno.
    log('--- escenario 2: restaurar con -wal huerfano de un cierre abrupto ---');

    conn.getDb().prepare("UPDATE config SET valor = 'C' WHERE clave = 'estado'").run();
    backup.restaurarRespaldo(r.ruta);
    conn.getDb().close();

    const HUELLA = 'wal-huerfano-de-la-base-anterior';
    fs.writeFileSync(dbPath + '-wal', HUELLA, 'utf-8');
    fs.writeFileSync(dbPath + '-shm', HUELLA, 'utf-8');

    conn.conectar();

    const walSuelto = fs.existsSync(dbPath + '-wal')
      ? fs.readFileSync(dbPath + '-wal', 'utf-8').includes(HUELLA)
      : false;
    check('el -wal huerfano NO quedo junto a la base restaurada', !walSuelto,
          walSuelto ? 'sigue ahi, la base restaurada se abriria contra el' : 'movido');

    const shmSuelto = fs.existsSync(dbPath + '-shm')
      ? fs.readFileSync(dbPath + '-shm', 'utf-8').includes(HUELLA)
      : false;
    check('el -shm huerfano NO quedo junto a la base restaurada', !shmSuelto);

    const seguridad2 = fs.readdirSync(testDir).filter(f => f.startsWith('gym.db.antes-de-restaurar-'));
    check('el -wal se movio junto a su base, no se borro',
          seguridad2.some(f => f.endsWith('-wal')), seguridad2.join(', '));
    check('el -shm se movio junto a su base',
          seguridad2.some(f => f.endsWith('-shm')), seguridad2.join(', '));

    const estadoFinal = conn.getDb().prepare("SELECT valor FROM config WHERE clave='estado'").get();
    check('la base restaurada sigue legible y en estado A',
          estadoFinal && estadoFinal.valor === 'A',
          'leyo: ' + (estadoFinal ? estadoFinal.valor : 'null'));

    conn.getDb().close();
  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallos === 0 ? 0 : 1);
});
