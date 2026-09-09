const { nativeImage } = require('electron');
const { getDb } = require('../db/connection');
const { cifrarBuffer, descifrarBuffer, obtenerDekEnMemoria } = require('../crypto/dek');

// Mecanismo unico de imagenes del proyecto: foto de cliente, imagen de producto
// y logo del gimnasio pasan todos por aqui. Antes de esto no habia ninguno, y la
// alternativa era acabar con tres formas distintas de guardar lo mismo.
//
// Se guardan cifradas dentro de gym.db, no sueltas en una carpeta del disco.
// Asi los respaldos y el restaurar que ya funcionan se las llevan sin tocarlos,
// y las fotos de los clientes no quedan legibles para cualquiera que abra el PC
// de recepcion.

const ENTIDADES = ['cliente', 'producto', 'gimnasio'];

// La foto que llega del telefono del cliente pesa varios megas y se va a ver en
// un recuadro de 200 px. Guardarla tal cual multiplicaria por cien el tamano de
// la base sin que se note ninguna diferencia en pantalla.
const LADO_MAXIMO = 512;
const CALIDAD_JPEG = 80;

// Tope de lo que se acepta de entrada, antes de reducir. Una foto de camara
// ronda los 5 MB; por encima de 15 es que alguien esta metiendo otra cosa.
const MAXIMO_ENTRADA = 15 * 1024 * 1024;

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function esPng(buffer) {
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(FIRMA_PNG);
}

function validarEntidad(entidad, entidadId) {
  if (!ENTIDADES.includes(entidad)) return 'entidad_invalida';
  // El logo del gimnasio es unico y no cuelga de ninguna fila, asi que va sin id.
  // Las otras dos siempre apuntan a un cliente o a un producto concreto.
  if (entidad === 'gimnasio' && entidadId != null) return 'entidad_invalida';
  if (entidad !== 'gimnasio' && !Number.isInteger(entidadId)) return 'entidad_invalida';
  return null;
}

// SQLite no considera iguales dos NULL, asi que "WHERE entidad_id = NULL" no
// encuentra el logo. Se compara con el mismo COALESCE del indice unico.
const DONDE = `entidad = ? AND COALESCE(entidad_id, -1) = COALESCE(?, -1)`;

// Reduce y reencoda. Se mantiene PNG si entro PNG, porque un logo con fondo
// transparente pasado a JPEG sale con un rectangulo negro detras.
function normalizar(original) {
  let imagen = nativeImage.createFromBuffer(original);
  if (imagen.isEmpty()) return null;

  const tam = imagen.getSize();
  const lado = Math.max(tam.width, tam.height);
  if (lado > LADO_MAXIMO) {
    imagen = tam.width >= tam.height
      ? imagen.resize({ width: LADO_MAXIMO, quality: 'good' })
      : imagen.resize({ height: LADO_MAXIMO, quality: 'good' });
  }

  const png = esPng(original);
  const bytes = png ? imagen.toPNG() : imagen.toJPEG(CALIDAD_JPEG);
  const finales = imagen.getSize();

  return { bytes, mime: png ? 'image/png' : 'image/jpeg', ancho: finales.width, alto: finales.height };
}

function guardar({ entidad, entidadId = null, base64 }) {
  const malaEntidad = validarEntidad(entidad, entidadId);
  if (malaEntidad) return { ok: false, motivo: malaEntidad };

  const dek = obtenerDekEnMemoria();
  if (!dek) return { ok: false, motivo: 'sin_dek' };

  if (typeof base64 !== 'string' || base64.length === 0) return { ok: false, motivo: 'vacia' };

  // El renderer puede mandar el data URL entero tal cual sale de un FileReader.
  const limpio = base64.replace(/^data:[^;]+;base64,/, '');
  const original = Buffer.from(limpio, 'base64');
  if (original.length === 0) return { ok: false, motivo: 'vacia' };
  if (original.length > MAXIMO_ENTRADA) return { ok: false, motivo: 'muy_grande' };

  const normalizada = normalizar(original);
  if (!normalizada) return { ok: false, motivo: 'no_es_imagen' };

  const db = getDb();
  const tx = db.transaction(() => {
    // Reemplazar en vez de acumular: cada cosa tiene una imagen, no un historial.
    db.prepare(`DELETE FROM imagenes WHERE ${DONDE}`).run(entidad, entidadId);
    db.prepare(`
      INSERT INTO imagenes (entidad, entidad_id, mime, bytes, ancho, alto, tamano, creada_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entidad, entidadId, normalizada.mime, cifrarBuffer(normalizada.bytes, dek),
           normalizada.ancho, normalizada.alto, normalizada.bytes.length, new Date().toISOString());
  });
  tx();

  return {
    ok: true,
    mime: normalizada.mime,
    ancho: normalizada.ancho,
    alto: normalizada.alto,
    tamano: normalizada.bytes.length,
  };
}

// Devuelve un data URL listo para poner en el src de una <img>, o null si no
// hay imagen. Null no es un error: la mayoria de los clientes no van a tener
// foto y cada pantalla decide que dibujar en su lugar.
function obtener(entidad, entidadId = null) {
  if (validarEntidad(entidad, entidadId)) return null;

  const dek = obtenerDekEnMemoria();
  if (!dek) return null;

  const fila = getDb()
    .prepare(`SELECT mime, bytes FROM imagenes WHERE ${DONDE}`)
    .get(entidad, entidadId);
  if (!fila) return null;

  try {
    return 'data:' + fila.mime + ';base64,' + descifrarBuffer(fila.bytes, dek).toString('base64');
  } catch (e) {
    // Una fila que no descifra es una fila de otra DEK. Devolver null deja a la
    // pantalla mostrar su marcador generico en vez de reventar la vista entera.
    return null;
  }
}

// Para una cuadricula entera. Pedir imagen por imagen serian tantos viajes de
// IPC como productos haya cada vez que se abre la pantalla de vender; asi es una
// consulta y un viaje. Devuelve un objeto id -> data URL, sin las que no tienen.
function obtenerVarias(entidad, ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return {};
  if (!ENTIDADES.includes(entidad) || entidad === 'gimnasio') return {};

  const dek = obtenerDekEnMemoria();
  if (!dek) return {};

  const enteros = ids.filter(Number.isInteger);
  if (enteros.length === 0) return {};

  const huecos = enteros.map(() => '?').join(',');
  const filas = getDb()
    .prepare(`SELECT entidad_id, mime, bytes FROM imagenes
              WHERE entidad = ? AND entidad_id IN (${huecos})`)
    .all(entidad, ...enteros);

  const salida = {};
  for (const f of filas) {
    try {
      salida[f.entidad_id] = 'data:' + f.mime + ';base64,' + descifrarBuffer(f.bytes, dek).toString('base64');
    } catch (e) {
      // Una fila que no descifra se omite. La pantalla dibuja su marcador.
    }
  }
  return salida;
}

// Para listados: saber si hay foto sin arrastrar los bytes de cien clientes.
function existe(entidad, entidadId = null) {
  if (validarEntidad(entidad, entidadId)) return false;
  return !!getDb().prepare(`SELECT 1 FROM imagenes WHERE ${DONDE}`).get(entidad, entidadId);
}

function eliminar(entidad, entidadId = null) {
  const malaEntidad = validarEntidad(entidad, entidadId);
  if (malaEntidad) return { ok: false, motivo: malaEntidad };
  const info = getDb().prepare(`DELETE FROM imagenes WHERE ${DONDE}`).run(entidad, entidadId);
  return { ok: true, borradas: info.changes };
}

module.exports = { guardar, obtener, obtenerVarias, existe, eliminar, ENTIDADES, LADO_MAXIMO, MAXIMO_ENTRADA };
