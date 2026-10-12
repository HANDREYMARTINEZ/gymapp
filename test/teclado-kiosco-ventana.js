// El teclado numerico DENTRO de la ventana del kiosco de la segunda pantalla:
// que los digitos que manda el proceso principal se vean en el documento y el
// PIN, que el octavo marque solo, que el punto borre y que el siguiente cliente
// no tenga que esperar a que se borre el mensaje del anterior.
//
// test/teclado-kiosco.js prueba que las teclas lleguen; esta, lo que hace la
// pantalla con ellas. Necesita el bundle: va en `npm run test:produccion`.

const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-teclado-kiosco-ventana-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

const raiz = path.join(__dirname, '..');
const testDir = path.join(os.tmpdir(), 'gymapp-test-teclado-kiosco-ventana-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra !== undefined ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };
  let ventana = null;

  try {
    if (!fs.existsSync(path.join(raiz, 'dist', 'index.html'))) throw new Error('falta dist/: corre vite build antes');
    const { conectar, getDb } = require('../electron/db/connection');
    const dekMod = require('../electron/crypto/dek');
    conectar();
    const db = getDb();
    db.prepare(`INSERT INTO config (clave, valor) VALUES ('gym_nombre', 'Gimnasio Prueba')
                ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run();
    dekMod.guardarDekEnMemoria(dekMod.generarDEK());

    const dirIpc = path.join(raiz, 'electron', 'ipc');
    for (const f of fs.readdirSync(dirIpc)) if (f.endsWith('.js')) require(path.join(dirIpc, f));
    session.defaultSession.setPermissionRequestHandler((_wc, _p, conceder) => conceder(false));

    ventana = new BrowserWindow({
      width: 900, height: 760, show: false,
      webPreferences: { preload: path.join(raiz, 'electron', 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    ventana.showInactive();
    await ventana.loadFile(path.join(raiz, 'dist', 'index.html'), { hash: 'segunda-pantalla' });
    await esperar(1200);

    const wc = ventana.webContents;
    const js = (codigo) => wc.executeJavaScript(codigo);
    // Como lo manda electron/ipc/pantallaKiosco.js al llegar cada tecla.
    const tecla = async (t) => { wc.send('pantallaKiosco:tecla', t); await esperar(60); };
    const teclas = async (s) => { for (const t of s) await tecla(t === '.' ? 'borrar' : t); };
    const ULT4 = 'input[placeholder="Últimos 4 del documento"]';
    const PIN = 'input[placeholder="PIN"]';
    const valor = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).value`);
    const texto = () => js('document.body.innerText');

    check('la ventana del kiosco muestra la ayuda del teclado numerico',
          (await texto()).includes('teclado numérico'));

    await teclas('12');
    check('los digitos aparecen en el documento sin foco ni clic', (await valor(ULT4)) === '12', await valor(ULT4));
    await teclas('.');
    check('el punto borra el ultimo', (await valor(ULT4)) === '1', await valor(ULT4));
    await teclas('234');
    await teclas('56');
    check('despues de 4 sigue en el PIN', (await valor(ULT4)) === '1234' && (await valor(PIN)) === '56',
          (await valor(ULT4)) + '/' + (await valor(PIN)));
    await tecla('enter');
    check('Enter a medias avisa que faltan digitos', (await texto()).includes('Ingresa los 4 dígitos'));

    await teclas('78');
    await esperar(600);
    const t1 = await texto();
    check('el octavo digito marca solo (aqui: nadie con ese documento)', t1.includes('No registrado'), t1.slice(0, 200));

    await teclas('9');
    await esperar(200);
    check('con el mensaje en pantalla, un digito empieza de cero',
          !(await texto()).includes('No registrado') && (await valor(ULT4)) === '9' && (await valor(PIN)) === '',
          (await valor(ULT4)) + '/' + (await valor(PIN)));
  } catch (err) {
    check('la suite termina sin excepciones', false, err && err.stack);
  }

  if (ventana && !ventana.isDestroyed()) ventana.destroy();
  log('');
  log(fallos === 0 ? 'TODO OK' : fallos + ' FALLA(S)');
  volcar();
  app.exit(fallos === 0 ? 0 : 1);
});
