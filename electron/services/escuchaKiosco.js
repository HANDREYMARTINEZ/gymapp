const sidecar = require('./sidecarHuella');
const huellasRepo = require('./huellas');

// El lector de huella es UNO y el sidecar atiende a un solo oyente a la vez.
// Mientras hubo una sola ventana daba igual: el kiosco lo armaba al entrar y lo
// soltaba al salir. Con la segunda pantalla (pedida el 07-oct-2026) puede haber
// dos kioscos abiertos -- el de la ventana principal y el de la pantalla que mira
// a los clientes -- y si cada uno armara el lector por su cuenta pasaria esto:
//
//   - el ultimo en armarlo se quedaria con todas las huellas, y el otro mudo;
//   - salir del kiosco en la ventana principal (para vender) desarmaria tambien
//     el de la segunda pantalla, que es justo lo que no tiene que pasar.
//
// Por eso la escucha vive aqui, en el proceso principal: cada kiosco se apunta y
// se borra, el lector queda armado mientras quede al menos uno, y cada huella se
// resuelve UNA vez (una asistencia, un pulso de puerta) y se reparte a todos.
//
// Enrolar y el login de desarrollador usan el mismo lector para otra cosa. Esos
// lo "reservan": mientras dura, los kioscos se enteran de que esta ocupado, y al
// soltarlo se vuelve a armar con las huellas recargadas -- asi la que se acaba
// de enrolar ya entra sin tener que cerrar y abrir nada.

const oyentes = new Map(); // webContents.id -> webContents
let reservas = 0;
let armado = false;
let resolverHuella = null;
let cola = Promise.resolve();
let vigilante = null;

// La segunda pantalla se queda abierta todo el dia y nunca vuelve a montar el
// kiosco, que era lo que antes rearmaba el lector. Si el sidecar se cae y la app
// lo relanza, o si al abrir la pantalla todavia no contestaba, nadie lo volveria
// a armar y la huella dejaria de entrar sin un aviso. Esto lo revisa cada rato
// mientras haya algun kiosco escuchando.
const MS_VIGILANCIA = 30000;

// La logica de que hacer con una huella reconocida (asistencia, puerta, foto)
// vive en ipc/huellas.js; aqui solo se reparte. Se inyecta para no atar este
// modulo a la base ni a la puerta, y para poder probarlo sin lector.
function alResolver(fn) {
  resolverHuella = fn;
}

function enviarATodos(canal, datos) {
  for (const wc of oyentes.values()) {
    try { if (!wc.isDestroyed()) wc.send(canal, datos); } catch (e) { /* ventana cerrandose */ }
  }
}

async function alMatch(clienteId) {
  if (!resolverHuella || oyentes.size === 0) return;
  let respuesta;
  try {
    respuesta = await resolverHuella(clienteId);
  } catch (e) {
    return;
  }
  enviarATodos('kiosco:huellaDetectada', respuesta);
}

// Pone el lector en el estado que toca segun quien escucha y quien lo reserva.
// Va en cola: apuntarse y borrarse llegan muy seguidos (React monta, desmonta y
// vuelve a montar en desarrollo) y armar es asincrono; sin cola, un desarmado
// podia adelantarse a un armado anterior y dejar el lector al reves.
function sincronizar() {
  const paso = cola.then(async () => {
    if (oyentes.size === 0 || reservas > 0) {
      // Con soloSi: si quien tiene el lector ahora es el login de desarrollador,
      // no se le quita.
      if (armado) sidecar.detenerVerificacion(alMatch);
      armado = false;
      return { ok: true, armado: false };
    }
    const templates = huellasRepo.cargarTodasLasHuellas();
    await sidecar.iniciarVerificacion(templates, alMatch);
    armado = true;
    return { ok: true, armado: true, cantidad: templates.length };
  });
  // La cola sigue aunque este paso falle (sin lector): el siguiente lo reintenta.
  cola = paso.catch(() => {});
  return paso;
}

function revisar() {
  if (oyentes.size === 0 || reservas > 0) return;
  if (armado && sidecar.estaAbierto()) return;
  armado = false;
  sincronizar().catch(() => {});
}

function vigilar() {
  if (oyentes.size > 0 && !vigilante) {
    vigilante = setInterval(revisar, MS_VIGILANCIA);
  } else if (oyentes.size === 0 && vigilante) {
    clearInterval(vigilante);
    vigilante = null;
  }
}

function apuntar(wc) {
  if (!oyentes.has(wc.id)) {
    oyentes.set(wc.id, wc);
    // Si la ventana se cierra sin desmontar el kiosco (se cierra la segunda
    // pantalla, se apaga la app) se borra sola.
    wc.once('destroyed', () => borrar(wc));
  }
  vigilar();
  return sincronizar();
}

function borrar(wc) {
  if (!oyentes.delete(wc.id)) return Promise.resolve({ ok: true });
  vigilar();
  return sincronizar();
}

// Reservar devuelve la funcion para soltar, y soltar dos veces no descuenta dos.
function reservar() {
  reservas++;
  enviarATodos('kiosco:lectorOcupado', true);
  const desarmado = sincronizar();
  let suelto = false;
  const soltar = () => {
    if (suelto) return Promise.resolve();
    suelto = true;
    reservas = Math.max(0, reservas - 1);
    if (reservas === 0) enviarATodos('kiosco:lectorOcupado', false);
    return sincronizar().catch(() => {});
  };
  return { desarmado: desarmado.catch(() => {}), soltar };
}

// Para cuando cambian las huellas sin pasar por reservar (se borra una): el
// sidecar tiene su propia copia y hay que mandarle la nueva.
function recargar() {
  if (oyentes.size === 0) return Promise.resolve({ ok: true, armado: false });
  return sincronizar().catch(() => ({ ok: false }));
}

const estaOcupado = () => reservas > 0;

module.exports = {
  alResolver, apuntar, borrar, reservar, recargar, estaOcupado,
  // Solo para test/escucha-kiosco.js.
  _alMatch: alMatch,
  _estado: () => ({ oyentes: oyentes.size, reservas, armado }),
  _vigilarAhora: revisar,
};
