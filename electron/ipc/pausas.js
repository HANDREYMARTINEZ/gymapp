const { ipcMain } = require('electron');
const repo = require('../db/repos/pausas');

ipcMain.handle('pausas:pausar', (_evt, datos) => repo.pausar(datos));
ipcMain.handle('pausas:reactivar', (_evt, membresiaId) => repo.reactivar(membresiaId));
ipcMain.handle('pausas:listarPorMembresia', (_evt, membresiaId) => repo.listarPorMembresia(membresiaId));

module.exports = {};