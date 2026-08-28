const { ipcMain } = require('electron');
const repo = require('../db/repos/caja');

ipcMain.handle('caja:sesionAbierta', () => repo.sesionAbierta());
ipcMain.handle('caja:abrir', (_evt, datos) => repo.abrir(datos));
ipcMain.handle('caja:registrarMovimiento', (_evt, datos) => repo.registrarMovimiento(datos));
ipcMain.handle('caja:resumen', (_evt, sesionId) => repo.resumen(sesionId));
ipcMain.handle('caja:cerrar', (_evt, datos) => repo.cerrar(datos));
ipcMain.handle('caja:listarSesiones', (_evt, limite) => repo.listarSesiones(limite));
module.exports = {};
