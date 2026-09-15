const { ipcMain } = require('electron');
const repo = require('../db/repos/fiados');

// La cuenta de lo que debe un cliente (membresias y ventas fiadas) y cobrarla.
ipcMain.handle('fiados:cuenta', (_evt, clienteId) => repo.cuentaDeCliente(clienteId));
ipcMain.handle('fiados:cobrar', (_evt, datos) => repo.cobrar(datos));

module.exports = {};
