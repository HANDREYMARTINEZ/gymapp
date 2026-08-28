const { ipcMain } = require('electron');
const { getDb } = require('../db/connection');
const { derivarKEK, desenvolverDEK, guardarDekEnMemoria, obtenerDekEnMemoria } = require('../crypto/dek');

function getConfig(clave) {
  const row = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  return row ? row.valor : null;
}

ipcMain.handle('desbloqueo:intentar', (_evt, passphrase) => {
  try {
    const salt = getConfig('kdf_salt');
    const wrapped = getConfig('dek_wrapped_user');
    const kek = derivarKEK(passphrase, salt);
    const dek = desenvolverDEK(wrapped, kek);
    guardarDekEnMemoria(dek);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Passphrase incorrecta' };
  }
});

ipcMain.handle('desbloqueo:estaDesbloqueado', () => {
  return obtenerDekEnMemoria() !== null;
});

module.exports = {};