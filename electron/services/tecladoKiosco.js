const { globalShortcut } = require('electron');

// El teclado numerico del kiosco de la segunda pantalla (pedido el 12-oct-2026).
//
// La ventana del kiosco se abre sin robar el foco, para que recepcion siga
// vendiendo. Pero entonces el teclado numerico que hay junto al monitor de los
// clientes escribia en recepcion, y para marcar con PIN habia que llevar el
// raton al otro monitor -- con la recepcion sola, nadie lo hacia.
//
// Mientras el kiosco esta abierto, las teclas del BLOQUE numerico son suyas:
// 0-9 . + - * / y su Enter. Lo demas -- letras, los numeros de la fila de
// arriba, el Enter grande, el lector de codigos -- sigue yendo a recepcion.
// Windows no dice de que teclado viene cada tecla (sin un driver), asi que lo
// que se separa es la tecla, no el aparato: el bloque numerico del teclado de
// recepcion, si lo tiene, tambien va al kiosco mientras este abierto.
//
// Dos caminos, porque ninguno cubre todo:
//   - globalShortcut (RegisterHotKey): atrapa la tecla aunque el foco este en
//     otro programa. Pero no distingue el Enter del bloque del Enter grande,
//     y solo ve los digitos con Bloq Num encendido.
//   - before-input-event en las ventanas de GymApp: distingue por la tecla
//     fisica (code 'NumpadEnter', 'Numpad1' aunque Bloq Num este apagado),
//     pero solo cuando el foco esta en GymApp, que es casi siempre.

const ACELERADORES = {
  num0: '0', num1: '1', num2: '2', num3: '3', num4: '4',
  num5: '5', num6: '6', num7: '7', num8: '8', num9: '9',
  numdec: 'borrar', numadd: 'borrar', numsub: 'borrar', nummult: 'borrar', numdiv: 'borrar',
};

// Por la tecla fisica (KeyboardEvent.code).
function teclaPorCodigo(code) {
  if (typeof code !== 'string' || !code.startsWith('Numpad')) return null;
  const resto = code.slice('Numpad'.length);
  if (/^[0-9]$/.test(resto)) return resto;
  if (resto === 'Enter') return 'enter';
  if (['Decimal', 'Comma', 'Add', 'Subtract', 'Multiply', 'Divide'].includes(resto)) return 'borrar';
  return null;
}

// Un lector de codigos que cierre con el Enter del bloque llega pegado a sus
// digitos (~2 ms). Ese Enter es de recepcion, no del kiosco.
const PEGADO_MS = 100;

let destino = null; // (tecla) => void
let registrados = [];
// La ultima que entro por globalShortcut. Si Windows dejara pasar ademas la
// pulsacion a la ventana, before-input-event la mandaria otra vez.
let ultimaGlobal = { tecla: null, t: 0 };
const DOBLE_MS = 40;
const vigiladas = new WeakSet();
const ultimaNormal = new WeakMap();

function entregar(tecla) {
  if (!destino) return;
  try { destino(tecla); } catch (e) { /* una ventana que se cierra no tumba nada */ }
}

// Empieza a mandar el bloque numerico a `enviar`. Devuelve las teclas que
// Windows no dejo reservar (otro programa ya las tiene); esas solo llegan
// cuando el foco esta en GymApp.
function activar(enviar) {
  destino = enviar;
  const fallaron = [];
  for (const [acelerador, tecla] of Object.entries(ACELERADORES)) {
    if (registrados.includes(acelerador)) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(acelerador, () => {
        ultimaGlobal = { tecla, t: Date.now() };
        entregar(tecla);
      });
    } catch (e) { ok = false; }
    if (ok) registrados.push(acelerador);
    else fallaron.push(acelerador);
  }
  return { fallaron };
}

function desactivar() {
  destino = null;
  for (const acelerador of registrados) {
    try { globalShortcut.unregister(acelerador); } catch (e) {}
  }
  registrados = [];
}

const activo = () => destino !== null;

// Lo que hace before-input-event con una tecla. Separado para probarlo sin
// ventanas: devuelve { tragar, tecla } -- tragar = que no llegue a la pagina;
// tecla = la que se manda al kiosco (o null).
function decidir(input, ahora, ultimaTeclaNormal) {
  if (!activo() || !input) return { tragar: false, tecla: null };
  const tecla = teclaPorCodigo(input.code);
  if (!tecla) return { tragar: false, tecla: null };
  if (tecla === 'enter' && ultimaTeclaNormal && ahora - ultimaTeclaNormal <= PEGADO_MS) {
    return { tragar: false, tecla: null };
  }
  // keyUp se traga tambien, pero no manda nada: la tecla ya se mando al bajar.
  return { tragar: true, tecla: input.type === 'keyDown' ? tecla : null };
}

// Se engancha a cada ventana de GymApp (la principal y la del kiosco).
function vigilar(webContents) {
  if (!webContents || vigiladas.has(webContents)) return;
  vigiladas.add(webContents);
  webContents.on('before-input-event', (evento, input) => {
    const ahora = Date.now();
    if (input.type === 'keyDown' && !teclaPorCodigo(input.code)) ultimaNormal.set(webContents, ahora);
    const { tragar, tecla } = decidir(input, ahora, ultimaNormal.get(webContents));
    if (tragar) evento.preventDefault();
    if (tecla && !(tecla === ultimaGlobal.tecla && ahora - ultimaGlobal.t <= DOBLE_MS)) entregar(tecla);
  });
}

module.exports = { activar, desactivar, activo, vigilar, decidir, teclaPorCodigo, ACELERADORES, PEGADO_MS };
