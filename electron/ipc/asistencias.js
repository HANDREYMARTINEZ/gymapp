const { ipcMain } = require('electron');
const repo = require('../db/repos/asistencias');

ipcMain.handle('asistencias:registrar', (_evt, datos) => repo.registrar(datos));
ipcMain.handle('asistencias:listarDelDia', (_evt, fecha) => repo.listarDelDia(fecha));

module.exports = {};