const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-imagenes-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-imagenes-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

// Una imagen de verdad, generada en el momento: pintar un mapa de bits y dejar
// que Electron lo codifique. Asi la prueba no depende de ningun archivo suelto
// en el repositorio.
function generar(ancho, alto, png) {
  const pixeles = Buffer.alloc(ancho * alto * 4);
  for (let i = 0; i < ancho * alto; i++) {
    pixeles[i * 4 + 0] = (i * 7) % 256;   // B
    pixeles[i * 4 + 1] = (i * 13) % 256;  // G
    pixeles[i * 4 + 2] = (i * 29) % 256;  // R
    pixeles[i * 4 + 3] = 255;             // A
  }
  const img = nativeImage.createFromBitmap(pixeles, { width: ancho, height: alto });
  return png ? img.toPNG() : img.toJPEG(90);
}

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    // La base de Andrey ya existe y solo tiene aplicada la 001. Antes de nada se
    // reproduce ese escenario: base vieja con datos dentro, y se comprueba que
    // arrancar la app le anade la tabla nueva sin perder lo que ya habia.
    const Database = require('better-sqlite3');
    const rutaVieja = path.join(testDir, 'gym.db');
    const vieja = new Database(rutaVieja);
    vieja.exec(fs.readFileSync(path.join(__dirname, '../electron/db/migrations/001_init.sql'), 'utf-8'));
    vieja.exec(`CREATE TABLE IF NOT EXISTS _migraciones (nombre TEXT PRIMARY KEY, aplicada_en TEXT)`);
    vieja.prepare(`INSERT INTO _migraciones (nombre, aplicada_en) VALUES ('001_init.sql', ?)`)
         .run(new Date().toISOString());
    vieja.prepare(`INSERT INTO clientes (nombre, documento, f_registro) VALUES ('Cliente De Antes', '123', ?)`)
         .run('2026-01-01');
    vieja.close();

    const conn = require('../electron/db/connection');
    conn.conectar();

    check('al abrir una base que solo tenia la 001 se aplica la 002',
          !!conn.getDb().prepare(`SELECT 1 FROM _migraciones WHERE nombre = '002_imagenes.sql'`).get());
    check('y el cliente que ya estaba sigue ahi',
          conn.getDb().prepare(`SELECT nombre FROM clientes WHERE documento = '123'`).get().nombre
            === 'Cliente De Antes');
    const db = conn.getDb();
    const dekMod = require('../electron/crypto/dek');
    const imagenes = require('../electron/services/imagenes');

    const filaDe = (entidad, id) => db.prepare(
      `SELECT * FROM imagenes WHERE entidad = ? AND COALESCE(entidad_id, -1) = COALESCE(?, -1)`
    ).get(entidad, id ?? null);

    // --- sin passphrase no hay imagenes ---
    const pequena = generar(120, 90, false);
    const sinDek = imagenes.guardar({ entidad: 'cliente', entidadId: 1, base64: pequena.toString('base64') });
    check('sin la base desbloqueada no deja guardar', sinDek.ok === false && sinDek.motivo === 'sin_dek',
          'motivo=' + sinDek.motivo);

    dekMod.guardarDekEnMemoria(dekMod.generarDEK());

    // --- guardar y leer ---
    const r = imagenes.guardar({ entidad: 'cliente', entidadId: 1, base64: pequena.toString('base64') });
    check('guarda la foto de un cliente', r.ok === true, 'motivo=' + r.motivo);
    check('conserva el tamano cuando ya cabe', r.ancho === 120 && r.alto === 90,
          r.ancho + 'x' + r.alto);

    const url = imagenes.obtener('cliente', 1);
    check('la devuelve como data URL lista para una <img>',
          typeof url === 'string' && url.startsWith('data:image/jpeg;base64,'),
          (url || '').slice(0, 30));

    const devuelta = nativeImage.createFromDataURL(url);
    check('lo devuelto es una imagen valida y del mismo tamano',
          !devuelta.isEmpty() && devuelta.getSize().width === 120 && devuelta.getSize().height === 90);

    // --- lo importante: en disco no queda legible ---
    const fila = filaDe('cliente', 1);
    check('en la tabla no queda la cabecera JPEG en claro',
          fila.bytes.indexOf(Buffer.from([0xFF, 0xD8, 0xFF])) !== 0);
    check('los bytes guardados son mas largos que el claro (iv + tag)',
          fila.bytes.length === fila.tamano + 28, fila.bytes.length + ' vs ' + fila.tamano);
    check('con otra DEK no se puede leer',
          (() => {
            const original = dekMod.obtenerDekEnMemoria();
            dekMod.guardarDekEnMemoria(crypto.randomBytes(32));
            const intento = imagenes.obtener('cliente', 1);
            dekMod.guardarDekEnMemoria(original);
            return intento === null;
          })());

    // --- reduccion ---
    const grande = generar(1600, 900, false);
    const rg = imagenes.guardar({ entidad: 'cliente', entidadId: 2, base64: grande.toString('base64') });
    check('reduce una imagen grande al lado maximo',
          rg.ok && rg.ancho === imagenes.LADO_MAXIMO, rg.ancho + 'x' + rg.alto);
    check('y respeta la proporcion', rg.alto === Math.round(900 * (imagenes.LADO_MAXIMO / 1600)),
          'alto=' + rg.alto);
    check('la guardada pesa mucho menos que la original',
          rg.tamano < grande.length / 2, rg.tamano + ' vs ' + grande.length);

    const alta = generar(400, 1200, false);
    const ra = imagenes.guardar({ entidad: 'cliente', entidadId: 3, base64: alta.toString('base64') });
    check('en una imagen vertical el lado que limita es el alto',
          ra.ok && ra.alto === imagenes.LADO_MAXIMO, ra.ancho + 'x' + ra.alto);

    // --- PNG: el logo con transparencia no puede acabar en JPEG ---
    const logo = generar(200, 200, true);
    const rl = imagenes.guardar({ entidad: 'gimnasio', base64: logo.toString('base64') });
    check('guarda el logo del gimnasio sin id', rl.ok === true, 'motivo=' + rl.motivo);
    check('un PNG se guarda como PNG, no como JPEG', rl.mime === 'image/png', rl.mime);
    check('y se recupera con el mismo tipo',
          (imagenes.obtener('gimnasio') || '').startsWith('data:image/png;base64,'));

    // --- el data URL entero tambien vale ---
    const rd = imagenes.guardar({
      entidad: 'producto', entidadId: 5,
      base64: 'data:image/jpeg;base64,' + pequena.toString('base64'),
    });
    check('acepta el data URL completo tal cual sale de un FileReader', rd.ok === true,
          'motivo=' + rd.motivo);

    // --- reemplazo, no acumulacion ---
    imagenes.guardar({ entidad: 'cliente', entidadId: 1, base64: generar(300, 300, false).toString('base64') });
    const cuantas = db.prepare(
      `SELECT COUNT(*) AS n FROM imagenes WHERE entidad = 'cliente' AND entidad_id = 1`).get().n;
    check('volver a guardar sustituye, no deja dos filas', cuantas === 1, 'filas=' + cuantas);
    check('y la que queda es la nueva',
          nativeImage.createFromDataURL(imagenes.obtener('cliente', 1)).getSize().width === 300);

    // --- rechazos ---
    check('rechaza lo que no es una imagen',
          imagenes.guardar({ entidad: 'cliente', entidadId: 9,
            base64: Buffer.from('esto es un txt, no una foto').toString('base64') }).motivo === 'no_es_imagen');
    check('rechaza una entidad inventada',
          imagenes.guardar({ entidad: 'factura', entidadId: 1,
            base64: pequena.toString('base64') }).motivo === 'entidad_invalida');
    check('rechaza un cliente sin id',
          imagenes.guardar({ entidad: 'cliente', base64: pequena.toString('base64') }).motivo === 'entidad_invalida');
    check('rechaza un logo con id, que seria un segundo logo',
          imagenes.guardar({ entidad: 'gimnasio', entidadId: 1,
            base64: pequena.toString('base64') }).motivo === 'entidad_invalida');
    check('rechaza vacio', imagenes.guardar({ entidad: 'cliente', entidadId: 9, base64: '' }).motivo === 'vacia');
    check('rechaza algo mas grande que el tope de entrada',
          imagenes.guardar({ entidad: 'cliente', entidadId: 9,
            base64: Buffer.alloc(imagenes.MAXIMO_ENTRADA + 1).toString('base64') }).motivo === 'muy_grande');

    // --- existe / eliminar ---
    check('existe() dice que si cuando la hay', imagenes.existe('cliente', 1) === true);
    check('existe() dice que no cuando no la hay', imagenes.existe('cliente', 999) === false);
    check('obtener() de algo sin imagen devuelve null, no revienta',
          imagenes.obtener('cliente', 999) === null);

    const del = imagenes.eliminar('cliente', 1);
    check('eliminar borra la fila', del.ok === true && del.borradas === 1);
    check('y despues ya no existe', imagenes.existe('cliente', 1) === false);
    check('eliminar algo que no estaba no es un error',
          imagenes.eliminar('cliente', 1).borradas === 0);

    // --- las demas siguen intactas ---
    check('borrar una no toca las otras',
          imagenes.existe('cliente', 2) && imagenes.existe('producto', 5) && imagenes.existe('gimnasio'));

    // --- varias de golpe, para pintar una cuadricula ---
    imagenes.guardar({ entidad: 'producto', entidadId: 7, base64: generar(80, 80, false).toString('base64') });
    const varias = imagenes.obtenerVarias('producto', [5, 7, 999]);
    check('obtenerVarias trae las que existen', Object.keys(varias).length === 2,
          'trajo ' + Object.keys(varias).join(', '));
    check('y no inventa entrada para la que no tiene imagen', !(999 in varias));
    check('cada una es un data URL usable', String(varias[5]).startsWith('data:image/'));
    check('coincide con lo que devuelve obtener() una a una',
          varias[5] === imagenes.obtener('producto', 5));
    check('con la lista vacia devuelve vacio, no todas',
          Object.keys(imagenes.obtenerVarias('producto', [])).length === 0);
    check('no mezcla entidades: pedir productos no trae clientes',
          Object.keys(imagenes.obtenerVarias('producto', [2])).length === 0);
    check('ignora ids que no son numeros',
          Object.keys(imagenes.obtenerVarias('producto', ['5', null, 7])).length === 1);

    // --- respaldo y restauracion ---
    //
    // Esta es la razon de haber elegido guardar las imagenes dentro de gym.db en
    // vez de en una carpeta aparte: el respaldo cifrado y el restaurar que ya
    // existian se las llevan sin haber tocado ni una linea de ellos. Si algun dia
    // se moviesen a disco, esta comprobacion es la que se pondria roja.
    const backup = require('../electron/services/backup');
    const antesDelRespaldo = imagenes.obtener('producto', 5);
    const respaldo = await backup.generarRespaldo();
    check('se genera un respaldo con la imagen dentro', respaldo.ok === true);

    imagenes.eliminar('producto', 5);
    imagenes.guardar({ entidad: 'cliente', entidadId: 77, base64: pequena.toString('base64') });
    check('despues del respaldo la imagen del producto ya no esta',
          imagenes.existe('producto', 5) === false);

    backup.restaurarRespaldo(respaldo.ruta);
    conn.getDb().close();
    conn.conectar();

    check('al restaurar vuelve la imagen del producto', imagenes.existe('producto', 5) === true);
    check('y vuelve byte a byte, no una version degradada',
          imagenes.obtener('producto', 5) === antesDelRespaldo);
    check('lo guardado despues del respaldo desaparece, como el resto de la base',
          imagenes.existe('cliente', 77) === false);

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
