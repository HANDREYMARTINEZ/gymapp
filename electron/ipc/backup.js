const { ipcMain } = require('electron');
const backupService = require('../services/backup');

ipcMain.handle('backup:generar', async () => {
  return backupService.generarRespaldo();
});

ipcMain.handle('backup:listar', () => {
  return backupService.listarRespaldos();
});

module.exports = {};