const { ipcMain } = require('electron');
const repo = require('../db/repos/ventas');
const { MEDIOS } = require('../services/medios-pago');

ipcMain.handle('ventas:registrar', (_evt, datos) => repo.registrar(datos));
ipcMain.handle('ventas:obtener', (_evt, ventaId) => repo.obtener(ventaId));
ipcMain.handle('ventas:listarDelDia', (_evt, fecha) => repo.listarDelDia(fecha));
ipcMain.handle('ventas:totalesDelDia', (_evt, fecha) => repo.totalesDelDia(fecha));
ipcMain.handle('ventas:fueraDeCajaDelDia', (_evt, fecha) => repo.fueraDeCajaDelDia(fecha));
ipcMain.handle('ventas:fueraDeCajaEntre', (_evt, desde, hasta) => repo.fueraDeCajaEntre(desde, hasta));
ipcMain.handle('ventas:anular', (_evt, datos) => repo.anular(datos));
ipcMain.handle('ventas:mediosPago', () => MEDIOS);
module.exports = {};
