// Diagnostico del lector de codigos de barras (SAT LD101R PLUS).
//
//   npm run lector
//
// Abre una ventana: se escanean ahi unos cuantos productos y por cada uno dice
//   - que codigo llego,
//   - cuanto tardo el lector entre tecla y tecla (lo que hay que saber para
//     afinar src/lector/detector.mjs),
//   - si la app lo reconoceria como escaneo con los ajustes de ahora,
//   - y, si es un EAN-13, si su digito de control cuadra. Un EAN-13 que no cuadra
//     casi siempre es el idioma del teclado del lector distinto al de Windows:
//     el lector manda "la tecla del 7" y Windows la traduce a otra cosa.
//
// Todo se va escribiendo tambien en %TEMP%\gymapp-lector-diagnostico.txt.
// Se termina cerrando la ventana.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INFORME = path.join(os.tmpdir(), 'gymapp-lector-diagnostico.txt');

// El detector es un modulo ES de la app. Aqui se inyecta en la pagina como
// texto, quitandole los export, para que el diagnostico use EXACTAMENTE la misma
// logica y los mismos ajustes que la app.
const detectorFuente = fs.readFileSync(path.join(__dirname, '..', 'src', 'lector', 'detector.mjs'), 'utf-8')
  .replace(/^export\s+/gm, '');

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Diagnostico del lector</title>
<style>
  body { font-family: Segoe UI, sans-serif; background:#111; color:#eee; margin:24px; }
  #caja { border:2px dashed #ffe500; padding:22px; font-size:20px; text-align:center; border-radius:8px; }
  table { border-collapse:collapse; width:100%; margin-top:18px; font-size:14px; }
  td, th { border-bottom:1px solid #333; padding:6px; text-align:left; }
  .bien { color:#51cf66; } .mal { color:#ff6b6b; } .tenue { color:#888; }
</style></head><body>
<div id="caja">Escanea aquí 3 o 4 productos distintos, uno por uno.<br><span class="tenue">Cuando termines, cierra esta ventana.</span></div>
<table><thead><tr><th>#</th><th>Código</th><th>Largo</th><th>Hueco máx.</th><th>Hueco medio</th><th>Enter tras</th><th>¿Lo reconoce la app?</th><th>EAN-13</th></tr></thead><tbody id="filas"></tbody></table>
</body></html>`;

app.whenReady().then(async () => {
  const lineas = [];
  const escribir = (t) => { lineas.push(t); process.stdout.write(t + '\n'); fs.writeFileSync(INFORME, lineas.join('\n'), 'utf-8'); };

  const ventana = new BrowserWindow({ width: 1000, height: 640, title: 'Diagnóstico del lector', webPreferences: { contextIsolation: true, sandbox: true } });
  await ventana.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGINA));

  await ventana.webContents.executeJavaScript(`
    ${detectorFuente}
    window.__resultados = [];
    (function () {
      let teclas = [];
      function ean13Valido(c) {
        if (!/^\\d{13}$/.test(c)) return null;
        const d = c.split('').map(Number);
        const suma = d.slice(0, 12).reduce((s, n, i) => s + n * (i % 2 ? 3 : 1), 0);
        return (10 - (suma % 10)) % 10 === d[12];
      }
      window.addEventListener('keydown', (e) => {
        e.preventDefault();
        if (e.key !== 'Enter') {
          teclas.push({ key: e.key, t: e.timeStamp, repeat: e.repeat });
          return;
        }
        const escribe = teclas.filter(k => k.key.length === 1);
        if (escribe.length === 0) { teclas = []; return; }
        const huecos = [];
        for (let i = 1; i < escribe.length; i++) huecos.push(escribe[i].t - escribe[i - 1].t);
        const det = crearDetector();
        for (const k of teclas) det.tecla(k.key, k.t, k.repeat);
        const veredicto = det.tecla('Enter', e.timeStamp, false);
        const codigo = escribe.map(k => k.key).join('');
        const r = {
          codigo, largo: codigo.length,
          huecoMax: huecos.length ? Math.max(...huecos) : 0,
          huecoMedio: huecos.length ? huecos.reduce((a, b) => a + b, 0) / huecos.length : 0,
          enterTras: e.timeStamp - escribe[escribe.length - 1].t,
          reconocido: veredicto.tipo === 'codigo' && veredicto.codigo === codigo,
          ean13: ean13Valido(codigo),
          raros: /[^0-9A-Za-z\\-]/.test(codigo),
        };
        window.__resultados.push(r);
        const n = window.__resultados.length;
        const fila = document.createElement('tr');
        fila.innerHTML = '<td>' + n + '</td><td>' + codigo.replace(/</g, '&lt;') + '</td><td>' + r.largo + '</td>'
          + '<td>' + r.huecoMax.toFixed(1) + ' ms</td><td>' + r.huecoMedio.toFixed(1) + ' ms</td><td>' + r.enterTras.toFixed(1) + ' ms</td>'
          + '<td class="' + (r.reconocido ? 'bien">Sí' : 'mal">NO') + '</td>'
          + '<td class="' + (r.ean13 === null ? 'tenue">—' : r.ean13 ? 'bien">cuadra' : 'mal">NO cuadra') + '</td>';
        document.getElementById('filas').appendChild(fila);
        teclas = [];
      }, true);
    })();
    true;
  `);

  escribir('=== Diagnostico del lector (' + new Date().toLocaleString('es-CO') + ') ===');
  escribir('Ajustes de la app: ' + detectorFuente.match(/MAX_ENTRE_TECLAS_MS:\s*\d+/)[0] + ', '
    + detectorFuente.match(/MAX_ANTES_DEL_ENTER_MS:\s*\d+/)[0] + ', ' + detectorFuente.match(/MIN_LARGO:\s*\d+/)[0]);
  escribir('Escanea en la ventana. Cierrala para terminar.');
  escribir('');

  let vistos = 0;
  async function leer() {
    if (ventana.isDestroyed()) return;
    let res = [];
    try { res = await ventana.webContents.executeJavaScript('window.__resultados'); } catch (e) { return; }
    for (; vistos < res.length; vistos++) {
      const r = res[vistos];
      escribir('#' + (vistos + 1) + '  ' + r.codigo + '  (' + r.largo + ' car.)'
        + '  hueco max ' + r.huecoMax.toFixed(1) + ' ms, medio ' + r.huecoMedio.toFixed(1) + ' ms, Enter tras ' + r.enterTras.toFixed(1) + ' ms'
        + '  -> ' + (r.reconocido ? 'LA APP LO RECONOCE' : 'LA APP NO LO RECONOCERIA')
        + (r.ean13 === null ? '' : r.ean13 ? '  | EAN-13 cuadra' : '  | EAN-13 NO CUADRA (¿idioma del teclado del lector?)')
        + (r.raros ? '  | CARACTERES RAROS' : ''));
    }
  }
  const reloj = setInterval(leer, 400);

  // Una ultima lectura ANTES de cerrar: un escaneo hecho justo antes de cerrar
  // la ventana se quedaba fuera del informe.
  let cerrando = false;
  ventana.on('close', (e) => {
    if (cerrando) return;
    e.preventDefault();
    cerrando = true;
    clearInterval(reloj);
    leer().finally(() => {
      escribir('');
      escribir(vistos === 0 ? 'No se escaneo nada.' : 'Fin. ' + vistos + ' escaneo(s). Informe en ' + INFORME);
      ventana.destroy();
      app.exit(0);
    });
  });

  // --simular: comprueba la herramienta sin lector. Teclea un EAN-13 valido a
  // velocidad de lector y otro a velocidad de persona, y cierra.
  if (process.argv.includes('--simular')) {
    const wc = ventana.webContents;
    wc.focus();
    const pulsar = (k) => {
      const keyCode = k === 'Enter' ? 'Return' : k;
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      wc.sendInputEvent({ type: 'char', keyCode: k === 'Enter' ? String.fromCharCode(13) : k });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
    };
    const esperar = (ms) => new Promise(r => setTimeout(r, ms));
    await esperar(500);
    for (const k of '4006381333931') pulsar(k);
    pulsar('Enter');
    await esperar(600);
    for (const k of '4006381333931') { pulsar(k); await esperar(90); }
    pulsar('Enter');
    await esperar(800);
    ventana.close();
  }
});
