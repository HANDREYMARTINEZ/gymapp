const { getDb } = require('../db/connection');
const { generarSalt, derivarKEK, envolverDEK, desenvolverDEK } = require('../crypto/dek');

// La misma DEK, envuelta varias veces con llaves distintas.
//
// Hasta ahora solo habia una envoltura: la de la passphrase, que por eso habia
// que escribir cada vez que se abria la app. Ahora cada usuario tiene la suya,
// hecha con su propia contrasena de login, asi que entrar al sistema ya abre el
// cifrado y no hace falta una segunda pantalla.
//
// Lo que NO cambia es que la DEK sigue sin estar en ningun sitio en claro: sin
// una contrasena valida (o la passphrase) el gym.db y sus respaldos no dicen
// nada. Esto quita una pantalla, no quita el cifrado.
//
// La passphrase se queda, pero con otro oficio: es la llave del desarrollador y
// el ultimo recurso si un dia no queda ningun usuario que pueda entrar.

const clave = (usuarioId) => 'dek_usuario_' + usuarioId;

function getConfig(k) {
  const row = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(k);
  return row ? row.valor : null;
}

function setConfig(k, v) {
  getDb().prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  ).run(k, v);
}

function tieneLlave(usuarioId) {
  return !!getConfig(clave(usuarioId));
}

// Cada usuario lleva su propio salt. Con uno compartido, dos usuarios con la
// misma contrasena producirian la misma KEK y se notaria comparando las filas.
async function guardarLlave(usuarioId, password, dek) {
  const salt = generarSalt();
  const kek = await derivarKEK(password, salt);
  setConfig(clave(usuarioId), JSON.stringify({ salt, envuelta: envolverDEK(dek, kek) }));
  return true;
}

async function abrirConPassword(usuarioId, password) {
  const guardado = getConfig(clave(usuarioId));
  if (!guardado) return null;
  try {
    const { salt, envuelta } = JSON.parse(guardado);
    return desenvolverDEK(envuelta, await derivarKEK(password, salt));
  } catch (e) {
    // Una llave que no abre es una contrasena cambiada por fuera o una fila
    // corrupta. Se trata como "no hay llave": el login pedira la passphrase una
    // vez y la volvera a crear, en vez de dejar al usuario fuera para siempre.
    return null;
  }
}

async function abrirConPassphrase(passphrase) {
  const salt = getConfig('kdf_salt');
  const envuelta = getConfig('dek_wrapped_user');
  if (!salt || !envuelta) return null;
  try {
    return desenvolverDEK(envuelta, await derivarKEK(passphrase, salt));
  } catch (e) {
    return null;
  }
}

// Al cambiar la contrasena hay que rehacer la envoltura: la vieja se abria con
// la contrasena anterior y ya no sirve. Si no hay DEK en memoria no se puede
// rehacer, asi que se borra en vez de dejar una que no abre; el proximo login
// pedira la passphrase una vez y la creara de nuevo.
async function rehacerLlave(usuarioId, passwordNueva, dek) {
  if (dek) return guardarLlave(usuarioId, passwordNueva, dek);
  getDb().prepare(`DELETE FROM config WHERE clave = ?`).run(clave(usuarioId));
  return false;
}

function olvidarLlave(usuarioId) {
  getDb().prepare(`DELETE FROM config WHERE clave = ?`).run(clave(usuarioId));
}

module.exports = {
  tieneLlave, guardarLlave, abrirConPassword, abrirConPassphrase, rehacerLlave, olvidarLlave,
};
