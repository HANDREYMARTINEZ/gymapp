const { ipcMain, BrowserWindow, screen } = require('electron');
const path = require('path');
const { getDb } = require('../db/connection');
const { numerar, buscarGuardada, elegirDestino } = require('../services/eleccionPantalla');

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
//
// Con tres o mas monitores, en cual va se elige en Configuracion (ver
// services/eleccionPantalla.js). Sin elegir, va en el primero de izquierda a
// derecha que no sea el de recepcion.

const CLAVE_RECORDAR = 'kiosco_segunda_pantalla';
const CLAVE_PANTALLA = 'kiosco_pantalla';

let ventana = null;
// Donde se abrio y desde que ventana, para poder recolocarla si cambian los
// monitores.
let destinoId = null;
let principalActual = null;
// La cerro un monitor que se desconecto, no una persona: si vuelve a haber
// donde ponerla, vuelve sola.
let cerradaPorMonitor = false;

function leerConfig(clave) {
  try {
    const fila = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
    return fila ? fila.valor : null;
  } catch (e) {
    return null;
  }
}

function escribirConfig(clave, valor) {
  getDb().prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  ).run(clave, valor);
}

function recordar(abierta) {
  try { escribirConfig(CLAVE_RECORDAR, abierta ? '1' : '0'); } catch (e) {
    /* recordarlo es comodidad, no puede impedir abrirla */
  }
}

const recordada = () => leerConfig(CLAVE_RECORDAR) === '1';

// { id, label } de la pantalla elegida en Configuracion, o null = automatico.
function pantallaGuardada() {
  try {
    const g = JSON.parse(leerConfig(CLAVE_PANTALLA) || 'null');
    return g && g.id !== undefined ? g : null;
  } catch (e) {
    return null;
  }
}

function estaAbierta() {
  return !!(ventana && !ventana.isDestroyed());
}

function vivaOPrincipal(principal) {
  if (principal && !principal.isDestroyed()) return principal;
  if (principalActual && !principalActual.isDestroyed()) return principalActual;
  return null;
}

function idRecepcion(principal) {
  const p = vivaOPrincipal(principal);
  return p ? screen.getDisplayMatching(p.getBounds()).id : screen.getPrimaryDisplay().id;
}

// Avisa a las demas ventanas para que el boton diga "Abrir" o "Cerrar".
function avisarCambio() {
  const abierta = estaAbierta();
  for (const v of BrowserWindow.getAllWindows()) {
    if (v === ventana) continue;
    try { v.webContents.send('pantallaKiosco:cambio', abierta); } catch (e) {}
  }
}

// Configuracion repinta la lista cuando se conecta o desconecta un monitor.
function avisarPantallas() {
  for (const v of BrowserWindow.getAllWindows()) {
    if (v === ventana) continue;
    try { v.webContents.send('pantallaKiosco:pantallasCambiaron'); } catch (e) {}
  }
}

function abrir(principal) {
  principal = vivaOPrincipal(principal);
  if (estaAbierta()) {
    return { ok: true, yaEstaba: true, segundaPantalla: ventana.isFullScreen() };
  }
  principalActual = principal;
  cerradaPorMonitor = false;

  const { destino, aviso } = elegirDestino(screen.getAllDisplays(), idRecepcion(principal), pantallaGuardada());
  destinoId = destino ? destino.id : null;

  // Con un solo monitor se abre como ventana normal: sirve para probar, y para
  // el dia que el segundo monitor este desconectado sin que el boton "no haga
  // nada". Con dos o mas, a pantalla completa en el elegido.
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
  const esta = ventana;
  esta.once('ready-to-show', () => {
    if (esta.isDestroyed()) return;
    esta.showInactive();
    if (destino) esta.setFullScreen(true);
  });

  esta.on('closed', () => {
    if (ventana === esta) {
      ventana = null;
      destinoId = null;
    }
    avisarCambio();
  });

  if (process.env.NODE_ENV === 'development') {
    esta.loadURL('http://localhost:5173/#segunda-pantalla');
  } else {
    esta.loadFile(path.join(__dirname, '../../dist/index.html'), { hash: 'segunda-pantalla' });
  }

  recordar(true);
  avisarCambio();
  avisarPantallas();
  return { ok: true, segundaPantalla: !!destino, aviso };
}

// recordarCerrada = false cuando la cierra la app al apagarse o porque se
// desconecto el monitor: la proxima vez tiene que volver.
function cerrar(recordarCerrada = true) {
  if (recordarCerrada) {
    recordar(false);
    cerradaPorMonitor = false;
  }
  if (estaAbierta()) ventana.destroy();
  ventana = null;
  destinoId = null;
  avisarPantallas();
  return { ok: true };
}

// Pone el kiosco donde tiene que estar AHORA. Se llama al cambiar la eleccion
// y al conectar o desconectar monitores:
//
//   - si desconectan el monitor del kiosco, Windows arrastra la ventana a otro
//     -- y a pantalla completa podria tapar a recepcion entera. Se cierra y,
//     si queda otro monitor libre, se abre ahi;
//   - si solo queda el de recepcion, se cierra y se espera: al volver a
//     conectar uno, vuelve sola;
//   - si vuelve el monitor elegido, el kiosco regresa a el.
function recolocar() {
  const principal = vivaOPrincipal(null);
  if (!principal) return;
  if (!estaAbierta() && !cerradaPorMonitor) return;

  const { destino } = elegirDestino(screen.getAllDisplays(), idRecepcion(principal), pantallaGuardada());

  if (estaAbierta()) {
    if (destino && destino.id === destinoId) return;
    // En ventana con un solo monitor: ahi no estorba, se deja.
    if (!destino && destinoId === null) return;
    cerrar(false);
  }

  if (destino) abrir(principal);
  else cerradaPorMonitor = true;
}

let relojRecolocar = null;
function vigilarMonitores() {
  // Windows dispara varios eventos seguidos al conectar o desconectar (cambio
  // de resolucion, reordenar escritorios); se espera a que se calme.
  const alCambiar = () => {
    clearTimeout(relojRecolocar);
    relojRecolocar = setTimeout(() => {
      try { recolocar(); } catch (e) {}
      avisarPantallas();
    }, 1000);
  };
  screen.on('display-removed', alCambiar);
  screen.on('display-added', alCambiar);
  screen.on('display-metrics-changed', alCambiar);
}

// Lo que pinta el selector de Configuracion.
function listar(principal) {
  const recepcion = idRecepcion(principal);
  const primaria = screen.getPrimaryDisplay().id;
  const todas = screen.getAllDisplays();
  const guardada = pantallaGuardada();
  const elegida = buscarGuardada(todas, guardada);
  return {
    pantallas: numerar(todas).map(p => ({
      id: p.id,
      numero: p.numero,
      modelo: p.label || '',
      ancho: p.bounds.width,
      alto: p.bounds.height,
      recepcion: p.id === recepcion,
      primaria: p.id === primaria,
      kiosco: estaAbierta() && p.id === destinoId,
    })),
    guardada,
    // La elegida se reconoce entre las conectadas (por id o por modelo).
    elegidaId: elegida ? elegida.id : null,
    abierta: estaAbierta(),
  };
}

function elegir(principal, id) {
  if (id === null || id === undefined || id === '') {
    escribirConfig(CLAVE_PANTALLA, '');
  } else {
    const p = screen.getAllDisplays().find(d => d.id === Number(id));
    if (!p) return { ok: false, motivo: 'no_esta' };
    if (p.id === idRecepcion(principal)) return { ok: false, motivo: 'es_recepcion' };
    escribirConfig(CLAVE_PANTALLA, JSON.stringify({ id: p.id, label: p.label || '' }));
  }
  if (!principalActual || principalActual.isDestroyed()) principalActual = vivaOPrincipal(principal);
  // Si esta abierta, se muda ya: elegir y no ver que pase nada confunde.
  recolocar();
  avisarPantallas();
  return { ok: true, ...listar(principal) };
}

// "Identificar": un numero grande en cada monitor unos segundos, para saber
// cual es cual sin adivinar por la resolucion.
let identificando = [];
function identificar(principal) {
  for (const v of identificando) { try { if (!v.isDestroyed()) v.destroy(); } catch (e) {} }
  identificando = [];

  const recepcion = idRecepcion(principal);
  for (const p of numerar(screen.getAllDisplays())) {
    const ancho = 420, alto = 300;
    const v = new BrowserWindow({
      x: Math.round(p.bounds.x + (p.bounds.width - ancho) / 2),
      y: Math.round(p.bounds.y + (p.bounds.height - alto) / 2),
      width: ancho, height: alto,
      frame: false, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false,
      backgroundColor: '#0c0b08',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    v.setMenu(null);
    const nota = p.id === recepcion ? 'Recepción (aquí está GymApp)' : (p.label || '');
    const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;'
      + 'flex-direction:column;align-items:center;justify-content:center;background:#0c0b08;'
      + 'color:#ffe14d;font-family:Segoe UI,sans-serif;border:4px solid #ffe14d;box-sizing:border-box">'
      + '<div style="font-size:150px;font-weight:800;line-height:1">' + p.numero + '</div>'
      + '<div style="font-size:22px;color:#eee;margin-top:10px">Pantalla ' + p.numero + '</div>'
      + '<div style="font-size:16px;color:#aaa;margin-top:4px">' + escaparHtml(nota) + '</div></body>';
    v.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    v.once('ready-to-show', () => { if (!v.isDestroyed()) v.showInactive(); });
    identificando.push(v);
  }
  const estas = identificando;
  setTimeout(() => {
    for (const v of estas) { try { if (!v.isDestroyed()) v.destroy(); } catch (e) {} }
  }, 4000);
  return { ok: true, cuantas: estas.length };
}

function escaparHtml(t) {
  return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const desde = (evt) => BrowserWindow.fromWebContents(evt.sender);

ipcMain.handle('pantallaKiosco:cerrar', () => cerrar(true));
ipcMain.handle('pantallaKiosco:alternar', (evt) =>
  (estaAbierta() ? cerrar(true) : abrir(desde(evt))));
ipcMain.handle('pantallaKiosco:estado', () => ({
  abierta: estaAbierta(),
  pantallas: screen.getAllDisplays().length,
}));
// Al entrar alguien: si el turno anterior la dejo abierta, vuelve.
ipcMain.handle('pantallaKiosco:abrirSiRecordada', (evt) =>
  (recordada() && !estaAbierta() ? abrir(desde(evt)) : { ok: true, abierta: estaAbierta() }));
ipcMain.handle('pantallaKiosco:pantallas', (evt) => listar(desde(evt)));
ipcMain.handle('pantallaKiosco:elegir', (evt, id) => elegir(desde(evt), id));
ipcMain.handle('pantallaKiosco:identificar', (evt) => identificar(desde(evt)));

module.exports = { abrir, cerrar, estaAbierta, vigilarMonitores };
