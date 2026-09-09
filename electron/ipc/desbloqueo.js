// Escrow y desbloqueo por passphrase: SE CONSERVAN A PROPOSITO.
//
// Ninguna pantalla llama a estos tres canales, y una auditoria de codigo muerto
// los senala. No lo son. El 06-sep-2026 se decidio que la app arranca en el
// Login y que cada usuario abre el cifrado con su contrasena, y que el escrow
// "sigue en el codigo y en los datos, pero ya no tiene entrada desde la
// interfaz". Es la ultima salida si algun dia nadie puede entrar: la DEK
// envuelta con la clave publica de recuperacion se abre desde aqui con la
// privada, sin pasar por ninguna contrasena de usuario.
//
// Borrarlos seria tirar la unica copia de esa puerta. Las suites desbloqueo.js
// y produccion.js los prueban justamente para que sigan funcionando el dia que
// hagan falta.

const { ipcMain } = require('electron');
const { getDb } = require('../db/connection');
const { derivarKEK, desenvolverDEK, desenvolverDEKConClavePrivada, guardarDekEnMemoria, obtenerDekEnMemoria } = require('../crypto/dek');

function getConfig(clave) {
  const row = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  return row ? row.valor : null;
}

ipcMain.handle('desbloqueo:intentar', async (_evt, passphrase) => {
  try {
    const salt = getConfig('kdf_salt');
    const wrapped = getConfig('dek_wrapped_user');
    const kek = await derivarKEK(passphrase, salt);
    const dek = desenvolverDEK(wrapped, kek);
    guardarDekEnMemoria(dek);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Passphrase incorrecta' };
  }
});

// setup:finalizar guarda el escrow bajo 'dek_wrapped_recovery'. Este handler
// leia 'dek_wrapped_dev', que no lo escribe nadie, asi que el acceso de
// desarrollador respondia "no hay clave de escrow" incluso con la clave privada
// correcta. Se lee el nombre real, no al reves: las bases ya instaladas tienen
// guardada la fila con ese nombre y renombrarla en setup las dejaria sin salida.
ipcMain.handle('desbloqueo:dev', (_evt, clavePrivadaPem) => {
  try {
    const wrapped = getConfig('dek_wrapped_recovery');
    if (!wrapped) return { ok: false, error: 'No hay clave de escrow guardada' };
    const dek = desenvolverDEKConClavePrivada(wrapped, clavePrivadaPem);
    guardarDekEnMemoria(dek);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Clave privada inválida' };
  }
});

ipcMain.handle('desbloqueo:estaDesbloqueado', () => {
  return obtenerDekEnMemoria() !== null;
});

module.exports = {};