const { getDb } = require('../db/connection');
const { cifrarBuffer, descifrarBuffer, obtenerDekEnMemoria } = require('../crypto/dek');

// La huella del desarrollador: una sola, para entrar al panel con el dedo en vez
// de escribir la passphrase (lo pidio Andrey el 06-oct-2026).
//
// Va en config y no en la tabla huellas a proposito. Esa tabla es la que carga
// el kiosco, y alli la huella del desarrollador abriria la puerta de la calle y
// marcaria asistencia de un "cliente" que no existe. Aparte, el kiosco nunca la
// ve.
//
// Se guarda cifrada con la DEK, como las de los clientes. La consecuencia, que
// Andrey eligio sabiendolo: la huella solo sirve cuando la base ya esta abierta
// (alguien entro desde que se arranco la app). Recien arrancada, sin DEK en
// memoria, no hay con que descifrarla y el desarrollador entra con la passphrase,
// que sigue valiendo siempre. Guardar una copia de la DEK para que la huella
// funcionara tambien en frio habria debilitado el cifrado de toda la base.
const CLAVE = 'huella_desarrollador';

// El id con que se le pasa al sidecar. Los clientes empiezan en 1, y en la
// escucha del desarrollador solo se carga esta huella, asi que no hay choque.
const ID_LECTOR = 0;

function leer() {
  const row = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(CLAVE);
  if (!row) return null;
  try { return JSON.parse(row.valor); } catch (e) { return null; }
}

function estado() {
  const g = leer();
  return { registrada: !!g, creadaEn: g ? g.creadaEn : null };
}

function guardar(templateBuffer) {
  const dek = obtenerDekEnMemoria();
  if (!dek) return { ok: false, motivo: 'base_cerrada' };
  const valor = JSON.stringify({
    template: cifrarBuffer(templateBuffer, dek).toString('base64'),
    creadaEn: new Date().toISOString(),
  });
  getDb().prepare(`
    INSERT INTO config (clave, valor) VALUES (?, ?)
    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor
  `).run(CLAVE, valor);
  return { ok: true };
}

// Lo que se le manda al sidecar para escuchar, o el motivo por el que no se puede.
function paraElLector() {
  const g = leer();
  if (!g) return { ok: false, motivo: 'sin_huella' };
  const dek = obtenerDekEnMemoria();
  if (!dek) return { ok: false, motivo: 'base_cerrada' };
  try {
    const plano = descifrarBuffer(Buffer.from(g.template, 'base64'), dek);
    return { ok: true, templates: [{ clienteId: ID_LECTOR, templateBase64: plano.toString('base64') }] };
  } catch (e) {
    // Cifrada con otra DEK: una base restaurada de otra instalacion. Hay que
    // volver a registrarla desde el panel.
    return { ok: false, motivo: 'huella_ilegible' };
  }
}

function borrar() {
  const info = getDb().prepare(`DELETE FROM config WHERE clave = ?`).run(CLAVE);
  return { ok: true, borrada: info.changes > 0 };
}

module.exports = { ID_LECTOR, estado, guardar, paraElLector, borrar };
