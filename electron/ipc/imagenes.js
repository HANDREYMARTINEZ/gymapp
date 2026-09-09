const { ipcMain } = require('electron');
const imagenes = require('../services/imagenes');

ipcMain.handle('imagenes:guardar', (_evt, datos) => imagenes.guardar(datos || {}));
ipcMain.handle('imagenes:obtener', (_evt, entidad, entidadId) => imagenes.obtener(entidad, entidadId ?? null));
ipcMain.handle('imagenes:obtenerVarias', (_evt, entidad, ids) => imagenes.obtenerVarias(entidad, ids));
ipcMain.handle('imagenes:existe', (_evt, entidad, entidadId) => imagenes.existe(entidad, entidadId ?? null));
ipcMain.handle('imagenes:eliminar', (_evt, entidad, entidadId) => imagenes.eliminar(entidad, entidadId ?? null));

module.exports = {};
