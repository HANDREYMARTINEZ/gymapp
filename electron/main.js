const { app, BrowserWindow } = require('electron');
const path = require('path');
const { conectar } = require('./db/connection');
require('./ipc/config');
require('./ipc/setup');
require('./ipc/auth');
require('./ipc/clientes');
require('./ipc/planes');
require('./ipc/membresias');
require('./ipc/pausas');
require('./ipc/asistencias');
require('./ipc/kiosco');


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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();

});