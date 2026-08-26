const { ipcMain } = require('electron');
const argon2 = require('argon2');
const { getDb } = require('../db/connection');

ipcMain.handle('auth:login', async (_evt, usuario, password) => {
  const row = getDb().prepare(
    `SELECT id, nombre, usuario, hash_pass, rol, activo FROM usuarios WHERE usuario = ?`
  ).get(usuario);

  if (!row || !row.activo) {
    return { ok: false, error: 'Usuario o contraseña incorrectos' };
  }

  const passwordValida = await argon2.verify(row.hash_pass, password);
  if (!passwordValida) {
    return { ok: false, error: 'Usuario o contraseña incorrectos' };
  }

  return { ok: true, usuario: { id: row.id, nombre: row.nombre, usuario: row.usuario, rol: row.rol } };
});

module.exports = {};