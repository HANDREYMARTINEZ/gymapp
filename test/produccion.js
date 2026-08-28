// Verifica la ruta que solo se usa cuando la app va empaquetada: cargar el
// bundle de dist/ con loadFile en vez del servidor de Vite, con el preload
// puesto y el sandbox activo. Es el camino que nunca se ejerce en desarrollo y
// justamente donde fallan las rutas relativas al empaquetar.
//
// La ventana se crea oculta: esto comprueba que la app arranca, no como se ve.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-produccion-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-produccion-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const raiz = path.join(__dirname, '..');

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  let ventana = null;
  try {
    const indexProd = path.join(raiz, 'dist', 'index.html');
    check('existe el bundle de produccion (dist/index.html)', fs.existsSync(indexProd),
          'corre la compilacion antes de esta prueba');
    if (!fs.existsSync(indexProd)) throw new Error('sin dist/, no hay nada que verificar');

    const assets = fs.existsSync(path.join(raiz, 'dist', 'assets'))
      ? fs.readdirSync(path.join(raiz, 'dist', 'assets'))
      : [];
    check('el bundle trae su javascript', assets.some(f => f.endsWith('.js')), assets.join(', '));

    // El index.html generado tiene que referenciar rutas relativas. Con rutas
    // absolutas ('/assets/...') el bundle carga con Vite pero queda en blanco al
    // abrirse con loadFile, que es como se abre empaquetado.
    const html = fs.readFileSync(indexProd, 'utf-8');
    check('las rutas del bundle son relativas, no absolutas',
          !/(src|href)="\//.test(html), 'base: "./" en vite.config.js');

    const { conectar } = require('../electron/db/connection');
    require('../electron/ipc/config');
    require('../electron/ipc/setup');
    require('../electron/ipc/auth');
    require('../electron/ipc/usuarios');
    require('../electron/ipc/clientes');
    require('../electron/ipc/planes');
    require('../electron/ipc/productos');
    require('../electron/ipc/caja');
    require('../electron/ipc/ventas');
    require('../electron/ipc/dashboard');
    require('../electron/ipc/membresias');
    require('../electron/ipc/pausas');
    require('../electron/ipc/asistencias');
    require('../electron/ipc/kiosco');
    require('../electron/ipc/desbloqueo');
    require('../electron/ipc/backup');
    check('todos los modulos IPC cargan sin reventar', true);

    conectar();
    check('la base se crea y migra', true);

    ventana = new BrowserWindow({
      width: 1200, height: 800, show: false,
      webPreferences: {
        preload: path.join(raiz, 'electron', 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    const errores = [];
    ventana.webContents.on('did-fail-load', (_e, code, desc) => errores.push(code + ' ' + desc));
    ventana.webContents.on('console-message', (_e, nivel, mensaje) => {
      if (nivel >= 2) errores.push('consola: ' + mensaje);
    });

    await ventana.loadFile(indexProd);
    check('loadFile carga el bundle sin fallar', errores.length === 0, errores.join(' | '));

    // Se le da un momento a React para montar antes de mirar el DOM.
    await new Promise(r => setTimeout(r, 1500));

    const puente = await ventana.webContents.executeJavaScript(
      'typeof window.api === "object" && window.api !== null'
    );
    check('el preload expuso window.api en la ventana', puente === true);

    const apis = await ventana.webContents.executeJavaScript(
      'window.api ? Object.keys(window.api).sort().join(",") : ""'
    );
    const esperadas = ['asistencias', 'auth', 'backup', 'caja', 'clientes', 'config',
                       'dashboard', 'desbloqueo', 'kiosco', 'membresias', 'pausas',
                       'planes', 'productos', 'setup', 'usuarios', 'ventas'];
    const faltan = esperadas.filter(a => !apis.split(',').includes(a));
    check('estan todas las familias de API esperadas', faltan.length === 0,
          faltan.length ? 'faltan: ' + faltan.join(', ') : apis.split(',').length + ' familias');

    const montado = await ventana.webContents.executeJavaScript(
      'document.getElementById("root") ? document.getElementById("root").innerHTML.length : -1'
    );
    check('React monto algo dentro de #root', montado > 0, montado + ' caracteres');

    const texto = await ventana.webContents.executeJavaScript('document.body.innerText');
    check('la app pinto su primera pantalla, no una en blanco',
          texto.trim().length > 0, JSON.stringify(texto.trim().slice(0, 60)));

    // Con la base recien creada, lo que toca es el asistente de configuracion.
    check('arranca en el asistente de configuracion', /Bienvenido|GymApp/i.test(texto),
          JSON.stringify(texto.trim().slice(0, 60)));

    // La ruta de la clave publica del escrow cambia al empaquetar. Aqui se
    // comprueba la de desarrollo; la de produccion usa process.resourcesPath.
    check('la clave publica del escrow existe donde el codigo la busca',
          fs.existsSync(path.join(raiz, 'resources', 'dev-public.pem')));

  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  if (ventana) ventana.destroy();
  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallos === 0 ? 0 : 1);
});
