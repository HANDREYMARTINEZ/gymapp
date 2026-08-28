const { ipcMain } = require('electron');
const { getDb } = require('../db/connection');
const { derivarKEK, desenvolverDEK, guardarDekEnMemoria, obtenerDekEnMemoria } = require('../crypto/dek');

// La passphrase es la llave de todo el cifrado y se podia probar infinitas veces
// sin coste. El freno es una espera creciente por intento fallido, no un bloqueo
// permanente: esto es una app de escritorio, no hay a quien pedirle que la
// desbloquee, y dejar fuera al dueno por teclear mal seria peor que el ataque.
//
// El contador vive en memoria a proposito. Reiniciar la app lo limpia, pero cada
// reinicio cuesta segundos y la espera vuelve a crecer desde el primer fallo, asi
// que probar a ciegas sigue siendo lento. Guardarlo en la base daria un freno mas
// duro a cambio de poder dejar al dueno encerrado tras un susto.
const ESPERAS_MS = [0, 0, 1000, 3000, 5000, 10000, 15000, 30000];
const ESPERA_MAXIMA_MS = 60000;

let fallosSeguidos = 0;
let esperarHasta = 0;

function esperaTrasFallos(n) {
  return n < ESPERAS_MS.length ? ESPERAS_MS[n] : ESPERA_MAXIMA_MS;
}

function getConfig(clave) {
  const row = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  return row ? row.valor : null;
}

function registrarFallo() {
  fallosSeguidos++;
  const espera = esperaTrasFallos(fallosSeguidos);
  esperarHasta = Date.now() + espera;

  getDb().prepare(`
    INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
    VALUES (NULL, 'desbloqueo_fallido', 'config', NULL, ?, ?)
  `).run(new Date().toISOString(), JSON.stringify({ fallosSeguidos, esperaMs: espera }));

  return espera;
}

const segundos = (ms) => Math.ceil(ms / 1000);

ipcMain.handle('desbloqueo:intentar', (_evt, passphrase) => {
  const restante = esperarHasta - Date.now();
  if (restante > 0) {
    return {
      ok: false,
      error: 'Demasiados intentos fallidos. Espera ' + segundos(restante) + ' segundos.',
      esperaMs: restante,
    };
  }

  try {
    const salt = getConfig('kdf_salt');
    const wrapped = getConfig('dek_wrapped_user');
    const kek = derivarKEK(passphrase, salt);
    const dek = desenvolverDEK(wrapped, kek);

    guardarDekEnMemoria(dek);
    fallosSeguidos = 0;
    esperarHasta = 0;
    return { ok: true };
  } catch (e) {
    const espera = registrarFallo();
    return {
      ok: false,
      error: espera > 0
        ? 'Passphrase incorrecta. Espera ' + segundos(espera) + ' segundos antes de reintentar.'
        : 'Passphrase incorrecta.',
      esperaMs: espera,
    };
  }
});

ipcMain.handle('desbloqueo:estaDesbloqueado', () => {
  return obtenerDekEnMemoria() !== null;
});

// Solo para pruebas: deja el contador como recien arrancada la app.
function reiniciarFrenoParaPruebas() {
  fallosSeguidos = 0;
  esperarHasta = 0;
}

module.exports = { esperaTrasFallos, reiniciarFrenoParaPruebas };
