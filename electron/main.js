const { app, BrowserWindow } = require('electron');
const path = require('path');
const { conectar } = require('./db/connection');
require('./ipc/config');
require('./ipc/setup');
require('./ipc/auth');
require('./ipc/clientes');
require('./ipc/planes');
require('./ipc/productos');
require('./ipc/membresias');
require('./ipc/pausas');
require('./ipc/asistencias');
require('./ipc/kiosco');
require('./ipc/desbloqueo');
require('./ipc/backup');


let mainWindow;

app.whenReady().then(() => {
  conectar();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
});

app.on('window-all-closed', async () => {
  try {
    const backupService = require('./services/backup');
    const { obtenerDekEnMemoria } = require('./crypto/dek');
    if (obtenerDekEnMemoria()) {
      await backupService.generarRespaldo();
      console.log('Respaldo automático generado al cerrar la app.');
    }
  } catch (e) {
    console.error('No se pudo generar el respaldo automático al cerrar:', e.message);
  }
  if (process.platform !== 'darwin') app.quit();
});