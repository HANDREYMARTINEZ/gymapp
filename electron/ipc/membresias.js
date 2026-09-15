const { ipcMain } = require('electron');
const repo = require('../db/repos/membresias');

ipcMain.handle('membresias:vender', (_evt, datos) => repo.vender(datos));
ipcMain.handle('membresias:anular', (_evt, datos) => repo.anular(datos));
ipcMain.handle('membresias:renovar', (_evt, datos) => repo.renovar(datos));
ipcMain.handle('membresias:cambiarFechaInicio', (_evt, datos) => repo.cambiarFechaInicio(datos));
ipcMain.handle('membresias:registrarPago', (_evt, datos) => repo.registrarPago(datos));
ipcMain.handle('membresias:fiar', (_evt, datos) => repo.fiar(datos));
ipcMain.handle('membresias:listarPorCliente', (_evt, clienteId) => repo.listarPorCliente(clienteId));
ipcMain.handle('membresias:pagosDelDia', (_evt, fecha) => repo.pagosDelDia(fecha));
ipcMain.handle('membresias:listarPagos', (_evt, membresiaId) => repo.listarPagos(membresiaId));

// Tiquetes de una ticketera ya vendida: anadir, quitar y consultar.
ipcMain.handle('membresias:ajustarTickets', (_evt, datos) => repo.ajustarTickets(datos));
ipcMain.handle('membresias:estadoTickets', (_evt, membresiaId) => repo.estadoTickets(membresiaId));

module.exports = {};