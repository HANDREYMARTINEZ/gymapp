const { ipcMain } = require('electron');
const repo = require('../db/repos/planes');

ipcMain.handle('planes:crear', (_evt, plan) => repo.crear(plan));
ipcMain.handle('planes:listar', () => repo.listar());
ipcMain.handle('planes:obtener', (_evt, id) => repo.obtenerPorId(id));
ipcMain.handle('planes:editar', (_evt, id, cambios) => repo.editar(id, cambios));
ipcMain.handle('planes:desactivar', (_evt, id) => repo.desactivar(id));

module.exports = {};