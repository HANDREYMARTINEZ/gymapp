const { ipcMain } = require('electron');
const repo = require('../db/repos/dashboard');

ipcMain.handle('dashboard:resumen', (_evt, opciones) => repo.resumen(opciones));
ipcMain.handle('dashboard:ingresosDelDia', (_evt, fecha) => repo.ingresosDelDia(fecha));
ipcMain.handle('dashboard:porVencer', (_evt, diasAviso) => repo.membresiasPorVencer(diasAviso));
module.exports = {};
