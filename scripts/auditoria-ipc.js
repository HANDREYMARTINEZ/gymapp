// Auditoria estatica del puente entre pantallas y backend.
//
// Tres listas y sus cruces:
//   A) canales que registra el main   (ipcMain.handle en electron/ipc/*.js)
//   B) canales que expone el preload  (ipcRenderer.invoke en preload.js)
//   C) metodos que llaman las pantallas (window.api.grupo.metodo en src/)
//
// Lo que importa: una pantalla que llama a algo que el preload no expone, o un
// preload que invoca un canal que nadie atiende, es un boton que no hace nada.

const fs = require('fs');
const path = require('path');

const path2 = require('path');
const raiz = process.argv[2] || path2.join(__dirname, '..');

function leer(p) { return fs.readFileSync(p, 'utf-8'); }
function jsx(dir, salida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsx(p, salida);
    else if (/\.jsx?$/.test(e.name)) salida.push(p);
  }
  return salida;
}

// --- A: canales atendidos ---------------------------------------------------
const dirIpc = path.join(raiz, 'electron', 'ipc');
const handlers = new Map(); // canal -> archivo
for (const f of fs.readdirSync(dirIpc)) {
  const texto = leer(path.join(dirIpc, f));
  for (const m of texto.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)) {
    handlers.set(m[1], f);
  }
}

// --- B: canales que usa el preload y su forma window.api.grupo.metodo -------
const preload = leer(path.join(raiz, 'electron', 'preload.js'));
const invocados = new Set();
for (const m of preload.matchAll(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g)) invocados.add(m[1]);

// El preload es un objeto anidado de un nivel: grupo: { metodo: ... }. Se lee a
// ojo con una maquina de estados minima en vez de evaluarlo, que requeriria
// electron.
const expuestos = new Set();   // "grupo.metodo"
let grupoActual = null;
let profundidad = 0;
for (const linea of preload.split(/\r?\n/)) {
  const abre = linea.match(/^\s*(\w+)\s*:\s*\{\s*$/);
  if (abre && profundidad === 0) { grupoActual = abre[1]; profundidad = 1; continue; }
  if (profundidad === 1 && /^\s*\},?\s*$/.test(linea)) { grupoActual = null; profundidad = 0; continue; }
  if (grupoActual) {
    const met = linea.match(/^\s*(\w+)\s*:/);
    if (met) expuestos.add(grupoActual + '.' + met[1]);
  }
}

// --- C: lo que llaman las pantallas ----------------------------------------
const usados = new Map(); // "grupo.metodo" -> [archivos]
for (const f of jsx(path.join(raiz, 'src'))) {
  const texto = leer(f);
  for (const m of texto.matchAll(/window\.api\.(\w+)\.(\w+)/g)) {
    const clave = m[1] + '.' + m[2];
    if (!usados.has(clave)) usados.set(clave, []);
    const corto = path.relative(raiz, f).replace(/\\/g, '/');
    if (!usados.get(clave).includes(corto)) usados.get(clave).push(corto);
  }
}

// --- D: modulos ipc que main.js no carga -----------------------------------
const main = leer(path.join(raiz, 'electron', 'main.js'));
const cargados = new Set([...main.matchAll(/require\('\.\/ipc\/(\w+)'\)/g)].map(m => m[1] + '.js'));
const sinCargar = fs.readdirSync(dirIpc).filter(f => f.endsWith('.js') && !cargados.has(f));

// --- E: la forma de los argumentos cuadra entre preload y handler ----------
//
// El fallo que se busca aqui no se ve nunca en pantalla: el preload manda dos
// argumentos sueltos y el handler espera un objeto (o al reves), asi que llega
// undefined y la operacion no hace nada, sin error.
const formaHandler = new Map(); // canal -> 'objeto' | 'posicional' | 'ninguno'
for (const f of fs.readdirSync(dirIpc)) {
  const texto = leer(path.join(dirIpc, f));
  for (const m of texto.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]\s*,\s*(?:async\s*)?\(([^)]*)\)/g)) {
    const params = m[2].split(',').slice(1).join(',').trim();
    formaHandler.set(m[1], !params ? 'ninguno' : (params.startsWith('{') ? 'objeto' : 'posicional'));
  }
}

const formaPreload = new Map(); // canal -> { forma, args }
for (const m of preload.matchAll(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]([^\r\n]*)/g)) {
  let resto = m[2].trim();
  if (resto.startsWith(',')) resto = resto.slice(1).trim();
  resto = resto.replace(/\)[,;]?\s*$/, '').trim();
  const forma = !resto ? 'ninguno' : (resto.startsWith('{') ? 'objeto' : 'posicional');
  const args = !resto ? 0 : (forma === 'objeto' ? 1 : resto.split(',').length);
  formaPreload.set(m[1], { forma, args, texto: resto });
}

const desajustes = [];
for (const [canal, fh] of formaHandler) {
  const fp = formaPreload.get(canal);
  if (!fp) continue;
  // 'ninguno' en el handler significa que no usa argumentos: da igual lo que llegue.
  if (fh === 'ninguno') continue;
  if (fh === 'objeto' && fp.forma !== 'objeto' && fp.forma !== 'posicional') continue;
  if (fh === 'objeto' && fp.forma === 'posicional' && fp.args > 1) {
    desajustes.push(canal + ': el handler espera UN objeto y el preload manda ' + fp.args + ' sueltos (' + fp.texto + ')');
  }
  if (fh === 'posicional' && fp.forma === 'objeto') {
    const nPos = 2; // basta con saber que el handler lee argumentos sueltos
    desajustes.push(canal + ': el handler lee argumentos sueltos y el preload manda un objeto (' + fp.texto + ')');
  }
}

// --- Informe ---------------------------------------------------------------
const linea = (t) => console.log(t);
let problemas = 0;

linea('Canales atendidos por el main : ' + handlers.size);
linea('Canales invocados por preload : ' + invocados.size);
linea('Metodos expuestos en window.api: ' + expuestos.size);
linea('Metodos usados por pantallas   : ' + usados.size);
linea('');

const invocadosSinHandler = [...invocados].filter(c => !handlers.has(c));
if (invocadosSinHandler.length) {
  problemas += invocadosSinHandler.length;
  linea('PROBLEMA - el preload invoca canales que nadie atiende:');
  invocadosSinHandler.forEach(c => linea('  ' + c));
} else linea('OK - todo canal del preload tiene quien lo atienda.');

const usadosSinExponer = [...usados.keys()].filter(k => !expuestos.has(k));
if (usadosSinExponer.length) {
  problemas += usadosSinExponer.length;
  linea('');
  linea('PROBLEMA - pantallas que llaman a algo que el preload no expone:');
  usadosSinExponer.forEach(k => linea('  window.api.' + k + '   <- ' + usados.get(k).join(', ')));
} else linea('OK - toda llamada de las pantallas existe en el preload.');

if (sinCargar.length) {
  problemas += sinCargar.length;
  linea('');
  linea('PROBLEMA - modulos de ipc/ que main.js no carga:');
  sinCargar.forEach(f => linea('  ' + f));
} else linea('OK - main.js carga todos los modulos de ipc/.');

linea('');
const handlersHuerfanos = [...handlers.keys()].filter(c => !invocados.has(c));
if (handlersHuerfanos.length) {
  linea('AVISO - canales atendidos que el preload no invoca (codigo muerto o uso interno):');
  handlersHuerfanos.forEach(c => linea('  ' + c + '   (' + handlers.get(c) + ')'));
} else linea('OK - ningun canal atendido queda sin usar.');

// Lo que ninguna pantalla usa PERO se conserva a proposito. Sin esta lista, la
// auditoria repite el mismo aviso cada vez y acaba sin leerse -- o peor, alguien
// borra la puerta de recuperacion por hacerle caso.
const CONSERVADOS = {
  'desbloqueo.intentar': 'escrow/recuperacion, sin entrada en la interfaz (ver electron/ipc/desbloqueo.js)',
  'desbloqueo.dev': 'escrow/recuperacion, sin entrada en la interfaz',
  'desbloqueo.estaDesbloqueado': 'escrow/recuperacion, sin entrada en la interfaz',
  'ventas.fueraDeCajaDelDia': 'lo usan las suites; la pantalla pide el rango',
  'productos.listarBajoMinimo': 'llega dentro del resumen del dashboard',
  'dashboard.porVencer': 'llega dentro del resumen del dashboard',
};

const expuestosSinUsar = [...expuestos].filter(k => !usados.has(k));
const sinExplicar = expuestosSinUsar.filter(k => !CONSERVADOS[k]);
if (sinExplicar.length) {
  linea('');
  linea('AVISO - metodos de window.api que ninguna pantalla usa:');
  sinExplicar.forEach(k => linea('  ' + k));
}

const conservados = expuestosSinUsar.filter(k => CONSERVADOS[k]);
if (conservados.length) {
  linea('');
  linea('Sin usar pero a proposito (no son codigo muerto):');
  conservados.forEach(k => linea('  ' + k + ' - ' + CONSERVADOS[k]));
}

linea('');
if (desajustes.length) {
  problemas += desajustes.length;
  linea('PROBLEMA - la forma de los argumentos no cuadra:');
  desajustes.forEach(d => linea('  ' + d));
} else linea('OK - preload y handlers se pasan los argumentos con la misma forma.');

linea('');
linea(problemas === 0 ? 'SIN PROBLEMAS' : problemas + ' PROBLEMA(S)');
process.exit(problemas === 0 ? 0 : 1);
