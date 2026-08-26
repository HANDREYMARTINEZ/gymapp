const { ipcMain } = require('electron');
const { getDb } = require('../db/connection');

ipcMain.handle('config:get', (_evt, clave) => {
  const row = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  return row ? row.valor : null;
});

ipcMain.handle('config:set', (_evt, clave, valor) => {
  getDb().prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  ).run(clave, valor);
  return true;
});