const { app, BrowserWindow, Menu, session } = require('electron');
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
require('./ipc/huellas');
require('./ipc/imagenes');
require('./ipc/intercambio');
require('./ipc/desarrollador');
require('./ipc/portapapeles');
require('./ipc/recordatorios');
require('./ipc/puerta');
require('./ipc/fiados');
const pantallaKiosco = require('./ipc/pantallaKiosco');



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

  // La camara hace falta para tomarle la foto al cliente en recepcion. Electron
  // sin handler concede casi todo por defecto; con este solo se concede la
  // camara, y todo lo demas (microfono, ubicacion, notificaciones, portapapeles)
  // se niega. La app se sirve de su propio bundle, asi que no hay pagina ajena
  // que pueda pedirlo.
  session.defaultSession.setPermissionRequestHandler((_wc, permiso, conceder) => {
    conceder(permiso === 'media');
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // El mismo negro de --fondo. Sin esto la ventana nace blanca y da un
    // fogonazo antes de que cargue el CSS, que en una app oscura se nota.
    backgroundColor: '#0c0b08',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // La segunda pantalla del kiosco depende de esta ventana: cerrar la principal
  // es cerrar la app, y con el kiosco abierto 'window-all-closed' no llegaria
  // nunca -- ni el respaldo al cerrar. No se olvida que estaba abierta: al volver
  // a entrar, vuelve.
  mainWindow.on('close', () => pantallaKiosco.cerrar(false));
  pantallaKiosco.vigilarMonitores();

  // El vigilante de los recordatorios de vencimiento. No manda nada hasta que
  // alguien entre -- necesita la DEK para leer la contrasena del correo -- y por
  // eso se puede arrancar aqui sin esperar a nada.
  require('./services/recordatorios').iniciarProgramador();

  // El Arduino de la puerta. Abrir el puerto serie resetea la placa y eso cuesta
  // un par de segundos; pagarlos aqui, al arrancar, evita que se los coma el
  // primer cliente que marque por la manana. Si no hay placa no pasa nada: la
  // puerta es un accesorio y el kiosco funciona sin ella.
  try { require('./services/puerta').arrancar(); } catch (e) {}

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
});

app.on('window-all-closed', async () => {
  try { require('./services/recordatorios').pararProgramador(); } catch (e) {}

  // El sidecar es un proceso hijo: si no se cierra aqui, cada arranque deja otro
  // vivo peleando por el puerto 8383 con el anterior.
  try { require('./services/sidecarProceso').apagar(); } catch (e) {}

  // Mientras la app tenga el puerto abierto, el IDE de Arduino no puede grabar
  // la placa: solo cabe un programa por COM.
  try { await require('./services/puerta').cerrar(); } catch (e) {}

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