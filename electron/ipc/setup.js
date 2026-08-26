const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const argon2 = require('argon2');
const { getDb } = require('../db/connection');
const { generarDEK, generarSalt, derivarKEK, envolverDEK, envolverDEKConClavePublica } = require('../crypto/dek');

function getConfig(clave) {
  const row = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  return row ? row.valor : null;
}

function setConfig(clave, valor) {
  getDb().prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  ).run(clave, valor);
}

ipcMain.handle('setup:estado', () => {
  return {
    setupCompleto: getConfig('setup_completo') === '1',
    pasoActual: parseInt(getConfig('setup_paso_actual') || '1', 10),
    gymNombre: getConfig('gym_nombre') || '',
    gymDireccion: getConfig('gym_direccion') || '',
    gymTelefono: getConfig('gym_telefono') || '',
    gymNit: getConfig('gym_nit') || '',
  };
});

ipcMain.handle('setup:datos-gimnasio', (_evt, datos) => {
  setConfig('gym_nombre', datos.nombre);
  setConfig('gym_direccion', datos.direccion || '');
  setConfig('gym_telefono', datos.telefono || '');
  setConfig('gym_nit', datos.nit || '');
  setConfig('setup_paso_actual', '3');
  return true;
});

ipcMain.handle('setup:crear-admin', async (_evt, datos) => {
  const hash = await argon2.hash(datos.password);
  getDb().prepare(
    `INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
     VALUES (?, ?, ?, 'admin', 1, ?)`
  ).run(datos.nombre, datos.usuario, hash, new Date().toISOString());
  setConfig('setup_paso_actual', '4');
  return true;
});

ipcMain.handle('setup:finalizar', (_evt, passphrase) => {
  const db = getDb();
  const publicKeyPem = fs.readFileSync(path.join(__dirname, '../../resources/dev-public.pem'), 'utf-8');

  const tx = db.transaction(() => {
    const dek = generarDEK();
    const salt = generarSalt();
    const kek = derivarKEK(passphrase, salt);

    const dekWrappedUser = envolverDEK(dek, kek);
    const dekWrappedRecovery = envolverDEKConClavePublica(dek, publicKeyPem);

    setConfig('kdf_salt', salt);
    setConfig('dek_wrapped_user', dekWrappedUser);
    setConfig('dek_wrapped_recovery', dekWrappedRecovery);
    setConfig('setup_completo', '1');
  });

  tx();
  return true;
});

module.exports = {};