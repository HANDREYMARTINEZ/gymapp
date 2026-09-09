const { ipcMain } = require('electron');
const repo = require('../db/repos/membresias');

ipcMain.handle('membresias:vender', (_evt, datos) => repo.vender(datos));
ipcMain.handle('membresias:anular', (_evt, datos) => repo.anular(datos));
ipcMain.handle('membresias:renovar', (_evt, datos) => repo.renovar(datos));
ipcMain.handle('membresias:cambiarFechaInicio', (_evt, datos) => repo.cambiarFechaInicio(datos));
ipcMain.handle('membresias:registrarPago', (_evt, datos) => repo.registrarPago(datos));
ipcMain.handle('membresias:listarPorCliente', (_evt, clienteId) => repo.listarPorCliente(clienteId));
ipcMain.handle('membresias:pagosDelDia', (_evt, fecha) => repo.pagosDelDia(fecha));
ipcMain.handle('membresias:listarPagos', (_evt, membresiaId) => repo.listarPagos(membresiaId));

module.exports = {};