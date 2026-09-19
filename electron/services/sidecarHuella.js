const proceso = require('./sidecarProceso');

const URL_SIDECAR = 'ws://127.0.0.1:8383';

// El lector de huella vive en un proceso aparte (el sidecar en C#) al que se
// habla por WebSocket. Eso significa que puede no estar corriendo, puede caerse
// a media operacion, y el usuario puede no poner nunca el dedo. Las tres cosas
// tienen que terminar en un mensaje en pantalla, nunca en una espera infinita:
// esto lo usa la recepcion con un cliente delante.

const MS_CONEXION = 4000;
// Enrolar pide cuatro lecturas del mismo dedo. Un minuto es de sobra para
// alguien que lo esta haciendo, y corto para alguien que se fue del mostrador.
const MS_ENROLAMIENTO = 60000;

let socket = null;
let resolverEnrolamiento = null;
let rechazarEnrolamiento = null;
let onMatchCallback = null;

function estaAbierto() {
  return socket && socket.readyState === 1; // 1 = OPEN
}

// Un socket que fallo o se cerro no sirve para nada, pero mientras siga guardado
// en la variable las siguientes llamadas creen que hay conexion y le mandan
// mensajes que nadie recibe. Ahi es donde se colgaba: send() sobre un socket
// cerrado no lanza error, descarta el mensaje en silencio, y la promesa que
// esperaba la respuesta se quedaba pendiente para siempre.
function soltar(motivo) {
  socket = null;
  if (rechazarEnrolamiento) {
    const rechazar = rechazarEnrolamiento;
    resolverEnrolamiento = null;
    rechazarEnrolamiento = null;
    rechazar(new Error(motivo));
  }
}

function conectar() {
  return new Promise((resolve, reject) => {
    let resuelto = false;
    const listo = (fn, arg) => { if (!resuelto) { resuelto = true; fn(arg); } };

    let s;
    try {
      s = new WebSocket(URL_SIDECAR);
    } catch (e) {
      reject(new Error('sin_lector'));
      return;
    }

    // Sin esto, un sidecar que acepta la conexion pero no contesta dejaria la
    // promesa colgada igual que antes.
    const reloj = setTimeout(() => {
      try { s.close(); } catch (e) {}
      socket = null;
      listo(reject, new Error('sin_lector'));
    }, MS_CONEXION);

    s.onopen = () => { clearTimeout(reloj); socket = s; listo(resolve); };
    s.onerror = () => {
      clearTimeout(reloj);
      soltar('sin_lector');
      listo(reject, new Error('sin_lector'));
    };
    s.onclose = () => { clearTimeout(reloj); soltar('conexion_cerrada'); };
    s.onmessage = (e) => {
      try { manejarMensaje(JSON.parse(e.data)); } catch (err) { /* mensaje ilegible: se ignora */ }
    };
  });
}

// Un sidecar recien lanzado tarda en abrir su servidor. Medido el 12-sep en esta
// maquina: la app intentaba conectar a los 28 ms y el 8383 no escuchaba hasta los
// ~370 ms. La conexion rechazada falla AL INSTANTE -- el reloj de MS_CONEXION solo
// cubre las que se cuelgan -- asi que el primer intento daba siempre 'sin_lector'
// con el lector enchufado. El kiosco se traga ese error a proposito, y la huella se
// quedaba sin escuchar durante toda esa visita al kiosco, sin un solo aviso.
//
// test/sidecar.js no lo veia porque espera 2,5 s despues de lanzar el proceso.
// Seis segundos de margen: aqui van 370 ms, pero el PC de recepcion puede ser mas
// lento, y en un arranque en frio .NET tarda bastante mas.
const MS_ARRANQUE_SIDECAR = 6000;
const MS_ENTRE_INTENTOS = 250;
let conectandoSidecar = null;

async function asegurarConexion() {
  if (estaAbierto()) return;
  // Dos llamadas a la vez (entrar al kiosco mientras se enrola) no pueden abrir
  // dos sockets: el segundo pisaria al primero y los mensajes del lector
  // llegarian a uno que ya nadie usa.
  if (conectandoSidecar) return conectandoSidecar;

  conectandoSidecar = (async () => {
    socket = null;
    // El sidecar es un proceso aparte y lo arranca la app. Antes habia que abrirlo
    // a mano desde Visual Studio y, si no estaba, aqui solo salia "sin lector".
    const encendido = proceso.asegurarEncendido();
    if (!encendido.ok) throw new Error(encendido.motivo);

    const limite = Date.now() + MS_ARRANQUE_SIDECAR;
    for (;;) {
      try {
        await conectar();
        return;
      } catch (e) {
        if (Date.now() >= limite) throw e;
        await new Promise(r => setTimeout(r, MS_ENTRE_INTENTOS));
      }
    }
  })();

  try {
    await conectandoSidecar;
  } finally {
    conectandoSidecar = null;
  }
}

function manejarMensaje(data) {
  // Si en el puerto contesta un sidecar que no es el nuestro -- tipico: uno
  // viejo que quedo abierto desde Visual Studio -- rechaza el token y cierra.
  // Sin esto la app se quedaba esperando una respuesta que no iba a llegar,
  // convencida de estar hablando con su propio proceso.
  if (data.error && rechazarEnrolamiento) {
    const rechazar = rechazarEnrolamiento;
    resolverEnrolamiento = null;
    rechazarEnrolamiento = null;
    rechazar(new Error('sidecar_ajeno'));
    return;
  }

  if (data.evento === 'templateListo' && resolverEnrolamiento) {
    const resolver = resolverEnrolamiento;
    resolverEnrolamiento = null;
    rechazarEnrolamiento = null;
    resolver(data.templateBase64);
  }
  if (data.evento === 'match' && onMatchCallback) {
    onMatchCallback(data.clienteId);
  }
}

async function enrolar(clienteId) {
  await asegurarConexion();
  return new Promise((resolve, reject) => {
    const reloj = setTimeout(() => {
      resolverEnrolamiento = null;
      rechazarEnrolamiento = null;
      reject(new Error('sin_respuesta'));
    }, MS_ENROLAMIENTO);

    resolverEnrolamiento = (t) => { clearTimeout(reloj); resolve(t); };
    rechazarEnrolamiento = (e) => { clearTimeout(reloj); reject(e); };

    try {
      socket.send(JSON.stringify({ token: proceso.token(), accion: 'enrolar', clienteId }));
    } catch (e) {
      clearTimeout(reloj);
      resolverEnrolamiento = null;
      rechazarEnrolamiento = null;
      reject(new Error('sin_lector'));
    }
  });
}

async function iniciarVerificacion(templates, callbackMatch) {
  await asegurarConexion();
  onMatchCallback = callbackMatch;
  socket.send(JSON.stringify({ token: proceso.token(), accion: 'cargarTemplates', templates }));
}

// Dejar de atender al lector. El sidecar sigue vivo y puede seguir leyendo
// dedos, pero sin oyente nadie registra asistencias ni abre la puerta.
//
// Hace falta porque la escucha se enciende al abrir el kiosco y no se apagaba
// nunca: con la app en Caja o en Configuracion, un dedo en el lector seguia
// marcando entrada y mandando abrir la calle sin que nadie viera nada en
// pantalla.
function detenerVerificacion() {
  onMatchCallback = null;
}

module.exports = { conectar, enrolar, iniciarVerificacion, detenerVerificacion, estaAbierto };
