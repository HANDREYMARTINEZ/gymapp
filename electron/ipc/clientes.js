const { ipcMain } = require('electron');
const repo = require('../db/repos/clientes');
const panel = require('../db/repos/panel-clientes');

ipcMain.handle('clientes:crear', (_evt, cliente) => repo.crear(cliente));
ipcMain.handle('clientes:buscar', (_evt, texto) => repo.buscar(texto));
ipcMain.handle('clientes:buscarConEstado', (_evt, texto) => panel.buscarConEstado(texto));
ipcMain.handle('clientes:panelLateral', () => panel.panelLateral());
ipcMain.handle('clientes:obtener', (_evt, id) => repo.obtenerPorId(id));
ipcMain.handle('clientes:editar', (_evt, id, cambios) => repo.editar(id, cambios));
ipcMain.handle('clientes:asignarPin', (_evt, id, pin) => repo.asignarPin(id, pin));
ipcMain.handle('clientes:tienePin', (_evt, id) => repo.tienePin(id));
ipcMain.handle('clientes:quitarPin', (_evt, id) => repo.quitarPin(id));

// Dar de baja y su vuelta atras. No borran nada: apagan y encienden el
// interruptor `activo` que toda la app ya respetaba, y lo anotan en auditoria.
ipcMain.handle('clientes:darDeBaja', (_evt, datos) => repo.darDeBaja(datos));
ipcMain.handle('clientes:reactivar', (_evt, datos) => repo.reactivar(datos));
ipcMain.handle('clientes:listarDadosDeBaja', () => repo.listarDadosDeBaja());

module.exports = {};