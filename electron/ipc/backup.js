const { ipcMain } = require('electron');
const { app } = require('electron');
const backupService = require('../services/backup');

ipcMain.handle('backup:generar', async () => {
  return backupService.generarRespaldo();
});

ipcMain.handle('backup:listar', () => {
  return backupService.listarRespaldos();
});
ipcMain.handle('backup:restaurar', (_evt, ruta) => {
  const resultado = backupService.restaurarRespaldo(ruta);
  if (resultado.ok && resultado.requiereReiniciar) {
    app.relaunch();
    app.exit(0);
  }
  return resultado;
});
module.exports = {};