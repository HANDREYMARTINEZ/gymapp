const { ipcMain } = require('electron');
const repo = require('../db/repos/membresias');

// vender() del repo devuelve el id y LANZA cuando algo no cuadra (plan
// desactivado, fecha rota, descuento imposible). Si ese error sale crudo por el
// IPC, la promesa de la pantalla se rechaza y el formulario se queda en
// "Vendiendo..." haciendo creer que la membresia se vendio. Aqui se traduce al
// mismo { ok, motivo } que contestan renovar() y el resto.
ipcMain.handle('membresias:vender', (_evt, datos) => {
  try {
    return { ok: true, membresiaId: repo.vender(datos || {}) };
  } catch (e) {
    return { ok: false, motivo: repo.motivoDeVenta(e) };
  }
});
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