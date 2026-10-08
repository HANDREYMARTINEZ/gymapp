const { ipcMain, BrowserWindow, screen } = require('electron');
const path = require('path');
const { getDb } = require('../db/connection');

// El kiosco en la segunda pantalla (pedido el 07-oct-2026). El gimnasio tiene
// dos monitores: el de recepcion y uno que mira a los clientes. Antes, para que
// alguien marcara con la huella, recepcion tenia que dejar a medias la venta o
// la inscripcion, ir al kiosco y volver -- y a veces se perdia lo que estaba
// haciendo. Ahora el kiosco puede vivir solo en el otro monitor, a pantalla
// completa, mientras la ventana principal sigue en lo suyo.
//
// Es UNA ventana mas de la misma app, no una segunda app: dos GymApp abiertas
// pelean por la base, por el puerto del sidecar y por el lector. El lector lo
// comparten los dos kioscos por services/escuchaKiosco.js.
//
// Se recuerda si quedo abierta: al entrar al dia siguiente vuelve sola. No se
// abre al arrancar la app sino al entrar alguien, porque las huellas van
// cifradas y sin la DEK en memoria el kiosco no las podria cargar.

const CLAVE_RECORDAR = 'kiosco_segunda_pantalla';

let ventana = null;

function recordar(abierta) {
  try {
    getDb().prepare(
      `INSERT INTO config (clave, valor) VALUES (?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
    ).run(CLAVE_RECORDAR, abierta ? '1' : '0');
  } catch (e) { /* recordarlo es comodidad, no puede impedir abrirla */ }
}

function recordada() {
  try {
    const fila = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(CLAVE_RECORDAR);
    return !!(fila && fila.valor === '1');
  } catch (e) {
    return false;
  }
}

function estaAbierta() {
  return !!(ventana && !ventana.isDestroyed());
}

// Avisa a las demas ventanas para que el boton diga "Abrir" o "Cerrar".
function avisarCambio() {
  const abierta = estaAbierta();
  for (const v of BrowserWindow.getAllWindows()) {
    if (v === ventana) continue;
    try { v.webContents.send('pantallaKiosco:cambio', abierta); } catch (e) {}
  }
}

// La pantalla que NO tiene a la ventana principal. Si hay mas de dos, la
// primera que no sea esa; si hay una sola, null.
function otraPantalla(principal) {
  const todas = screen.getAllDisplays();
  if (todas.length < 2) return null;
  const suya = principal && !principal.isDestroyed()
    ? screen.getDisplayMatching(principal.getBounds())
    : screen.getPrimaryDisplay();
  return todas.find(d => d.id !== suya.id) || null;
}

function abrir(principal) {
  if (estaAbierta()) {
    return { ok: true, yaEstaba: true, segundaPantalla: ventana.isFullScreen() };
  }

  const destino = otraPantalla(principal);

  // Con un solo monitor se abre como ventana normal: sirve para probar, y para
  // el dia que el segundo monitor este desconectado sin que el boton "no haga
  // nada". Con dos, a pantalla completa en el que no es el de recepcion.
  const opciones = destino
    ? { x: destino.bounds.x, y: destino.bounds.y,
        width: destino.bounds.width, height: destino.bounds.height,
        fullscreen: true, frame: false }
    : { width: 900, height: 760 };

  ventana = new BrowserWindow({
    ...opciones,
    title: 'Kiosco',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0c0b08',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  // El menu de desarrollo de la principal no pinta nada en la pantalla de los
  // clientes.
  ventana.setMenu(null);

  // Sin robar el foco: quien la abre esta atendiendo en la principal, y el
  // teclado y el lector de codigos tienen que seguir escribiendo ahi.
  ventana.once('ready-to-show', () => {
    if (!estaAbierta()) return;
    ventana.showInactive();
    if (destino) ventana.setFullScreen(true);
  });

  ventana.on('closed', () => {
    ventana = null;
    avisarCambio();
  });

  if (process.env.NODE_ENV === 'development') {
    ventana.loadURL('http://localhost:5173/#segunda-pantalla');
  } else {
    ventana.loadFile(path.join(__dirname, '../../dist/index.html'), { hash: 'segunda-pantalla' });
  }

  recordar(true);
  avisarCambio();
  return { ok: true, segundaPantalla: !!destino };
}

// recordarCerrada = false cuando la cierra la app al apagarse o porque se
// desconecto el monitor: la proxima vez tiene que volver.
function cerrar(recordarCerrada = true) {
  if (recordarCerrada) recordar(false);
  if (estaAbierta()) ventana.destroy();
  return { ok: true };
}

// Si desconectan el monitor de los clientes, Windows arrastra sus ventanas al
// que queda -- y el kiosco a pantalla completa taparia a recepcion entera. Se
// cierra, sin olvidar que estaba abierta.
function vigilarMonitores() {
  screen.on('display-removed', () => {
    if (!estaAbierta() || !ventana.isFullScreen()) return;
    if (screen.getAllDisplays().length < 2) cerrar(false);
  });
}

ipcMain.handle('pantallaKiosco:cerrar', () => cerrar(true));
ipcMain.handle('pantallaKiosco:alternar', (evt) =>
  (estaAbierta() ? cerrar(true) : abrir(BrowserWindow.fromWebContents(evt.sender))));
ipcMain.handle('pantallaKiosco:estado', () => ({
  abierta: estaAbierta(),
  pantallas: screen.getAllDisplays().length,
}));
// Al entrar alguien: si el turno anterior la dejo abierta, vuelve.
ipcMain.handle('pantallaKiosco:abrirSiRecordada', (evt) =>
  (recordada() && !estaAbierta() ? abrir(BrowserWindow.fromWebContents(evt.sender)) : { ok: true, abierta: estaAbierta() }));

module.exports = { abrir, cerrar, estaAbierta, vigilarMonitores };
