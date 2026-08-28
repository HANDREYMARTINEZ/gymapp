const { ipcMain } = require('electron');
const repo = require('../db/repos/usuarios');

ipcMain.handle('usuarios:listar', () => repo.listar());
ipcMain.handle('usuarios:obtener', (_evt, id) => repo.obtenerPorId(id));
ipcMain.handle('usuarios:crear', (_evt, datos) => repo.crear(datos));
ipcMain.handle('usuarios:editar', (_evt, id, cambios) => repo.editar(id, cambios));
ipcMain.handle('usuarios:cambiarPassword', (_evt, datos) => repo.cambiarPassword(datos));
ipcMain.handle('usuarios:desactivar', (_evt, id) => repo.desactivar(id));
ipcMain.handle('usuarios:activar', (_evt, id) => repo.activar(id));
ipcMain.handle('usuarios:roles', () => repo.ROLES);
module.exports = {};
