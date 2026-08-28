const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { conectar } = require('./db/connection');
require('./ipc/config');
require('./ipc/setup');
require('./ipc/auth');
require('./ipc/usuarios');
require('./ipc/clientes');
require('./ipc/planes');
require('./ipc/productos');
require('./ipc/caja');
require('./ipc/ventas');
require('./ipc/dashboard');
require('./ipc/membresias');
require('./ipc/pausas');
require('./ipc/asistencias');
require('./ipc/kiosco');
require('./ipc/desbloqueo');
require('./ipc/backup');


let mainWindow;

// El menu por defecto de Electron esta en ingles y ofrece cosas que en un
// mostrador de gimnasio solo estorban o hacen dano (recargar a media venta,
// herramientas de desarrollo). En produccion se quita del todo; en desarrollo se
// deja uno minimo, porque recargar y abrir el inspector si hacen falta ahi.
function instalarMenu() {
  if (process.env.NODE_ENV !== 'development') {
    Menu.setApplicationMenu(null);
    return;
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Desarrollo',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'forceReload', label: 'Recargar forzado' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
  ]));
}

app.whenReady().then(() => {
  instalarMenu();
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