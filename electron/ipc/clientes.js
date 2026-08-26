const { ipcMain } = require('electron');
const repo = require('../db/repos/clientes');

ipcMain.handle('clientes:crear', (_evt, cliente) => repo.crear(cliente));
ipcMain.handle('clientes:buscar', (_evt, texto) => repo.buscar(texto));
ipcMain.handle('clientes:obtener', (_evt, id) => repo.obtenerPorId(id));
ipcMain.handle('clientes:editar', (_evt, id, cambios) => repo.editar(id, cambios));

module.exports = {};