const { ipcMain } = require('electron');
const argon2 = require('argon2');
const { getDb } = require('../db/connection');

ipcMain.handle('auth:login', async (_evt, usuario, password) => {
  // Comparacion insensible a mayusculas: el repo de usuarios guarda el login en
  // minusculas, pero el wizard de setup no lo hacia, asi que puede haber cuentas
  // viejas con mayusculas. Con lower() a ambos lados entran las dos sin migrar
  // nada, y nadie queda fuera por como escribio su propio nombre de usuario.
  const row = getDb().prepare(
    `SELECT id, nombre, usuario, hash_pass, rol, activo FROM usuarios
     WHERE lower(usuario) = lower(?)`
  ).get(String(usuario || '').trim());

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