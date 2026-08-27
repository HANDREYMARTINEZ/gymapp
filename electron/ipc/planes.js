const { ipcMain } = require('electron');
const repo = require('../db/repos/planes');

ipcMain.handle('planes:crear', (_evt, plan) => repo.crear(plan));
ipcMain.handle('planes:listar', () => repo.listar());
ipcMain.handle('planes:obtener', (_evt, id) => repo.obtenerPorId(id));
ipcMain.handle('planes:editar', (_evt, id, cambios) => repo.editar(id, cambios));
ipcMain.handle('planes:desactivar', (_evt, id) => repo.desactivar(id));
ipcMain.handle('planes:activar', (_evt, id) => repo.activar(id));
ipcMain.handle('planes:listarTodos', () => repo.listarTodos());
module.exports = {};