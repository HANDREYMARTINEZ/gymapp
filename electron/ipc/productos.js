const { ipcMain } = require('electron');
const repo = require('../db/repos/productos');

ipcMain.handle('productos:crear', (_evt, producto) => repo.crear(producto));
ipcMain.handle('productos:listar', () => repo.listar());
ipcMain.handle('productos:listarTodos', () => repo.listarTodos());
ipcMain.handle('productos:obtener', (_evt, id) => repo.obtenerPorId(id));
ipcMain.handle('productos:obtenerPorCodigo', (_evt, codigo) => repo.obtenerPorCodigo(codigo));
ipcMain.handle('productos:editar', (_evt, id, cambios) => repo.editar(id, cambios));
ipcMain.handle('productos:desactivar', (_evt, id) => repo.desactivar(id));
ipcMain.handle('productos:activar', (_evt, id) => repo.activar(id));
ipcMain.handle('productos:buscarPorCodigo', (_evt, codigo) => repo.buscarPorCodigo(codigo));
ipcMain.handle('productos:moverLote', (_evt, datos) => repo.moverLote(datos));
ipcMain.handle('productos:motivosSalida', () => repo.MOTIVOS_SALIDA);
ipcMain.handle('productos:listarBajoMinimo', () => repo.listarBajoMinimo());
ipcMain.handle('productos:historialStock', (_evt, id) => repo.historialStock(id));
module.exports = {};
