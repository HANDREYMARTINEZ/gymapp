const { ipcMain } = require('electron');
const repo = require('../db/repos/membresias');

ipcMain.handle('membresias:vender', (_evt, datos) => repo.vender(datos));
ipcMain.handle('membresias:registrarPago', (_evt, datos) => repo.registrarPago(datos));
ipcMain.handle('membresias:listarPorCliente', (_evt, clienteId) => repo.listarPorCliente(clienteId));
ipcMain.handle('membresias:listarPagos', (_evt, membresiaId) => repo.listarPagos(membresiaId));

module.exports = {};