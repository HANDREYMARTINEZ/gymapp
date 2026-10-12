const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

// El teclado numerico del kiosco de la segunda pantalla: que hace cada tecla
// (src/kiosco/tecladoNumerico.mjs) y que el bloque numerico llegue al kiosco
// aunque el foco este en otra parte (electron/services/tecladoKiosco.js). La
// ultima parte pulsa teclas de verdad a traves de Windows.

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-teclado-kiosco-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-teclado-kiosco-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// Pulsa teclas virtuales con keybd_event, como lo haria un teclado USB.
function pulsar(vks) {
  const lista = vks.map(v => '0x' + v.toString(16)).join(',');
  const script = [
    'Add-Type -Name K -Namespace W -MemberDefinition \'[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e); [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint c, uint t);\'',
    // Con su codigo de tecla fisica, como un teclado de verdad: sin el,
    // Chromium no sabe que la tecla es del bloque numerico.
    'foreach ($v in @(' + lista + ')) { $s = [byte][W.K]::MapVirtualKey($v, 0); [W.K]::keybd_event([byte]$v, $s, 0, [System.UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [W.K]::keybd_event([byte]$v, $s, 2, [System.UIntPtr]::Zero); Start-Sleep -Milliseconds 60 }',
  ].join('; ');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true },
      (err) => resolve(!err));
  });
}

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    // -------------------------------------------------------- que hace cada tecla
    const { aplicarTecla, BORRAR, ENTER } = await import(
      pathToFileURL(path.join(__dirname, '..', 'src', 'kiosco', 'tecladoNumerico.mjs')).href);

    const vacio = { ult4: '', pin: '', hayResultado: false, enviando: false };
    let e = vacio;
    let r = null;
    for (const t of '1234') { r = aplicarTecla(e, t); e = { ...e, ult4: r.ult4, pin: r.pin }; }
    check('los cuatro primeros digitos van al documento', e.ult4 === '1234' && e.pin === '');
    check('con el documento completo todavia no marca', r.marcar === false);

    for (const t of '567') { r = aplicarTecla(e, t); e = { ...e, ult4: r.ult4, pin: r.pin }; }
    check('los siguientes van al PIN', e.ult4 === '1234' && e.pin === '567' && r.marcar === false);
    r = aplicarTecla(e, '8');
    check('el octavo digito marca solo', r.pin === '5678' && r.marcar === true);
    check('un noveno digito no hace nada', aplicarTecla({ ...e, pin: '5678' }, '9') === null);

    r = aplicarTecla({ ...vacio, ult4: '1234', pin: '56' }, BORRAR);
    check('borrar quita primero del PIN', r.ult4 === '1234' && r.pin === '5');
    r = aplicarTecla({ ...vacio, ult4: '12', pin: '' }, BORRAR);
    check('sin PIN, borrar quita del documento', r.ult4 === '1' && r.pin === '');
    check('borrar con todo vacio no hace nada', aplicarTecla(vacio, BORRAR) === null);

    r = aplicarTecla({ ...vacio, ult4: '12' }, ENTER);
    check('Enter a medias pide marcar (y marcar dira que faltan digitos)', r.marcar === true && r.ult4 === '12');

    check('mientras verifica, ninguna tecla hace nada',
          aplicarTecla({ ...vacio, ult4: '1234', pin: '567', enviando: true }, '8') === null);

    r = aplicarTecla({ ult4: '1234', pin: '5678', hayResultado: true, enviando: false }, '4');
    check('con el mensaje del anterior en pantalla, un digito empieza de cero',
          r.limpiarResultado === true && r.ult4 === '4' && r.pin === '' && r.marcar === false);
    check('con el mensaje en pantalla, borrar o Enter no hacen nada',
          aplicarTecla({ ...vacio, hayResultado: true }, BORRAR) === null
          && aplicarTecla({ ...vacio, hayResultado: true }, ENTER) === null);
    check('una tecla desconocida no hace nada', aplicarTecla(vacio, 'a') === null);

    // ------------------------------------------------- que teclas son del kiosco
    const tk = require('../electron/services/tecladoKiosco');
    check('Numpad7 es un 7', tk.teclaPorCodigo('Numpad7') === '7');
    check('el Enter del bloque es enter', tk.teclaPorCodigo('NumpadEnter') === 'enter');
    check('el punto, +, -, *, / del bloque borran',
          ['NumpadDecimal', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide']
            .every(c => tk.teclaPorCodigo(c) === 'borrar'));
    check('los numeros de la fila de arriba NO son del kiosco', tk.teclaPorCodigo('Digit7') === null);
    check('el Enter grande NO es del kiosco', tk.teclaPorCodigo('Enter') === null);
    check('Bloq Num no es del kiosco', tk.teclaPorCodigo('NumLock') === null);

    const enter = { type: 'keyDown', code: 'NumpadEnter' };
    check('con el kiosco cerrado no se traga nada', tk.decidir(enter, 1000, 0).tragar === false);

    const recibidas = [];
    const { fallaron } = tk.activar((t) => recibidas.push(t));
    check('se reservan las 15 teclas del bloque', fallaron.length === 0, fallaron.join(','));
    const { globalShortcut } = require('electron');
    check('num5 queda reservada en Windows', globalShortcut.isRegistered('num5'));

    let d = tk.decidir(enter, 1000, 0);
    check('con el kiosco abierto, el Enter del bloque se traga y va al kiosco', d.tragar && d.tecla === 'enter');
    d = tk.decidir({ type: 'keyUp', code: 'NumpadEnter' }, 1000, 0);
    check('al soltarlo se traga pero no se manda otra vez', d.tragar && d.tecla === null);
    d = tk.decidir({ type: 'keyDown', code: 'Numpad3' }, 1000, 0);
    check('Numpad3 con Bloq Num apagado tambien va al kiosco', d.tragar && d.tecla === '3');
    d = tk.decidir({ type: 'keyDown', code: 'Enter' }, 1000, 0);
    check('el Enter grande sigue en recepcion', !d.tragar && d.tecla === null);
    d = tk.decidir({ type: 'keyDown', code: 'Digit3' }, 1000, 0);
    check('el 3 de arriba sigue en recepcion', !d.tragar && d.tecla === null);
    d = tk.decidir(enter, 1000, 1000 - 5);
    check('un Enter del bloque pegado a otras teclas (lector de codigos) es de recepcion', !d.tragar && d.tecla === null);
    d = tk.decidir(enter, 1000, 1000 - tk.PEGADO_MS - 50);
    check('un Enter del bloque despues de una pausa es del kiosco', d.tragar && d.tecla === 'enter');

    // ----------------------------------------------- pulsaciones de verdad
    // Una ventana de otra cosa con el foco, como recepcion vendiendo.
    const { BrowserWindow } = require('electron');
    const otra = new BrowserWindow({ width: 300, height: 200, show: true });
    await otra.loadURL('data:text/html,<input id=c autofocus>');
    // Enganchada como la principal de GymApp: no puede llegar nada dos veces.
    tk.vigilar(otra.webContents);
    otra.focus();
    await otra.webContents.executeJavaScript('document.getElementById("c").focus()');
    await esperar(300);

    // VK_NUMPAD1, VK_NUMPAD2, VK_DECIMAL, VK_NUMPAD9, y el 7 de arriba ('7' = 0x37).
    const pulsado = await pulsar([0x61, 0x62, 0x6E, 0x69, 0x37]);
    await esperar(500);
    const enCampo = await otra.webContents.executeJavaScript('document.getElementById("c").value');
    check('se pudo pulsar teclas por Windows', pulsado);
    check('el bloque numerico llega al kiosco aunque el foco este en otra ventana',
          recibidas.join(',') === '1,2,borrar,9', recibidas.join(','));
    check('y no se escribe en la ventana con el foco; el 7 de arriba si', enCampo === '7', JSON.stringify(enCampo));

    tk.desactivar();
    check('al cerrar el kiosco se sueltan las teclas', !globalShortcut.isRegistered('num5') && !tk.activo());
    recibidas.length = 0;
    await otra.webContents.executeJavaScript('document.getElementById("c").value = ""; document.getElementById("c").focus()');
    otra.focus();
    await esperar(200);
    await pulsar([0x64]); // VK_NUMPAD4
    await esperar(400);
    const despues = await otra.webContents.executeJavaScript('document.getElementById("c").value');
    check('cerrado el kiosco, el bloque numerico vuelve a escribir donde esta el foco',
          recibidas.length === 0 && despues === '4', JSON.stringify(despues) + ' / ' + recibidas.join(','));
    otra.destroy();
  } catch (err) {
    check('la suite termina sin excepciones', false, err && err.stack);
  }

  log('');
  log(fallos === 0 ? 'TODO OK' : fallos + ' FALLA(S)');
  volcar();
  app.exit(fallos === 0 ? 0 : 1);
});
