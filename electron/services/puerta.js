// La puerta: un Arduino Nano conectado por USB que corta la corriente del
// electroiman durante unos segundos.
//
// TRES COSAS QUE HAY QUE TENER CLARAS ANTES DE TOCAR ESTO
//
// 1. El electroiman es "fail-safe": CON corriente esta cerrado, SIN corriente
//    abre. El rele va en NC (normalmente cerrado) en serie con los 12 V, asi
//    que abrir la puerta significa CORTAR, no dar. Si se cablea al reves, la
//    puerta se queda abierta siempre que el sistema este apagado.
//
// 2. La cuenta de los segundos vive DENTRO del Arduino, no aqui. Nosotros
//    mandamos "abre 5 segundos" y nos desentendemos. Si Windows se cuelga, si
//    la app se cierra o si alguien desenchufa el USB a mitad del pulso, la
//    placa cierra igual porque el reloj es suyo. La alternativa -- mandar
//    ABRIR y despues CERRAR -- deja la puerta abierta para siempre en cuanto
//    falle el segundo mensaje.
//
// 3. Esto es un accesorio, no un requisito. Si no hay placa, si falta el
//    driver, si el modulo nativo no carga: el kiosco tiene que seguir
//    registrando asistencias exactamente igual que hoy. Ninguna funcion de
//    aqui lanza hacia arriba; todas devuelven { ok: false, motivo }.

const { getDb } = require('../db/connection');

const BAUDIOS = 9600;
const FIRMA = 'GYMAPP-PUERTA';

// LA VENTANA DEL GESTOR DE ARRANQUE. Esto es lo mas delicado del archivo.
//
// Al abrir el puerto serie, el DTR baja y eso RESETEA la placa (el Nano lleva un
// condensador de DTR a RESET justo para que el IDE pueda grabarla). Tras el
// reset corre el gestor de arranque un par de segundos ANTES de llegar a
// setup(), y durante ese rato el gestor esta escuchando el puerto esperando un
// programa nuevo.
//
// Lo importante: no es que no nos oiga. Es que SI nos oye, y toma nuestros bytes
// por el principio de una programacion. Entonces se queda esperando datos que no
// van a llegar y **nunca arranca el sketch**. Un PING mandado demasiado pronto
// no se pierde: cuelga la placa hasta el siguiente reset.
//
// Eso es exactamente lo que pasaba: detectar() hablaba a los 1200 ms, dentro de
// la ventana, y la deteccion salia unas veces si y otras no. Una carrera contra
// el arranque de la placa, que es la peor clase de fallo intermitente.
//
// Asi que NO SE LE ESCRIBE NADA hasta pasada la ventana. Y normalmente ni hace
// falta: el sketch saluda solo al arrancar (~1,7 s), y ese saludo resuelve la
// conexion mucho antes. El PING se quedo solo como ultimo recurso, para una
// placa que por lo que sea no se reseteo al abrir y por tanto no saludo.
const MS_BOOTLOADER = 3000;
const MS_RESPUESTA = 1500;

const SEGUNDOS_POR_DEFECTO = 5;
const SEGUNDOS_MIN = 1;
const SEGUNDOS_MAX = 15;

let puerto = null;          // instancia de SerialPort abierta y saludada
let lector = null;          // el parser de lineas de esa instancia
let nombreAbierto = null;   // 'COM3'
let conectando = null;      // promesa en curso, para no abrir dos veces a la vez
let conectandoA = null;     // a QUE puerto va esa promesa -- ver asegurarConexion()
let ultimoFallo = null;
let moduloFallo = null;

// ---------------------------------------------------------------- el modulo

// serialport trae binario nativo. Si el dia de manana falla (una reinstalacion
// a medias, un electron nuevo), lo que NO puede pasar es que la app no arranque
// por culpa de la puerta. Por eso se carga tarde y envuelto.
function libreria() {
  try {
    return require('serialport');
  } catch (e) {
    moduloFallo = e.message;
    return null;
  }
}

// --------------------------------------------------------------- la config

function leerConfig(clave, siNoHay) {
  try {
    const fila = getDb().prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
    return fila && fila.valor !== null && fila.valor !== '' ? fila.valor : siNoHay;
  } catch (e) {
    return siNoHay; // base cerrada o aun sin abrir: no es motivo para reventar
  }
}

function escribirConfig(clave, valor) {
  try {
    getDb().prepare(
      `INSERT INTO config (clave, valor) VALUES (?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
    ).run(clave, String(valor));
  } catch (e) { /* igual que arriba */ }
}

function estaActiva() {
  return leerConfig('puerta_activa', '0') === '1';
}

function segundosConfigurados() {
  const n = parseInt(leerConfig('puerta_segundos', String(SEGUNDOS_POR_DEFECTO)), 10);
  if (!Number.isFinite(n)) return SEGUNDOS_POR_DEFECTO;
  return Math.min(SEGUNDOS_MAX, Math.max(SEGUNDOS_MIN, n));
}

// --------------------------------------------------------------- inventario

// El Nano V3.0 de Vistronica lleva un FT232, y FTDI es el fabricante 0403. No
// sirve para estar seguros -- hay mil cacharros con FT232 -- pero si para
// ordenar la lista y para que detectar() empiece por los candidatos buenos.
const FABRICANTE_FTDI = '0403';

async function listarPuertos() {
  const lib = libreria();
  if (!lib) return [];
  let lista;
  try {
    lista = await lib.SerialPort.list();
  } catch (e) {
    return [];
  }
  return lista.map(p => ({
    puerto: p.path,
    esFtdi: String(p.vendorId || '').toLowerCase() === FABRICANTE_FTDI,
    descripcion: p.friendlyName || p.pnpId || '',
    fabricante: p.manufacturer || '',
  })).sort((a, b) => (b.esFtdi === true) - (a.esFtdi === true));
}

// ------------------------------------------------------------------ hablar

// Abre, espera a que la placa termine de arrancar, le pregunta quien es y solo
// se da por buena si contesta con nuestra firma.
//
// Ese saludo no es ceremonia: en el puerto puede haber un lector de codigos,
// una impresora de tiquetes o un bluetooth. Mandarle "abre la puerta" a ciegas
// a lo que haya en COM4 es justo el fallo que el sidecar de huella ya tuvo
// (ver 'sidecar_ajeno'), y aqui acabaria con la puerta de la calle abierta.
function abrirPuerto(nombre) {
  const lib = libreria();
  if (!lib) return Promise.resolve({ ok: false, motivo: 'sin_modulo' });

  return new Promise((resolve) => {
    let resuelto = false;
    let s = null;
    const relojes = [];
    const terminar = (r) => {
      if (resuelto) return;
      resuelto = true;
      relojes.forEach(clearTimeout);
      // Un intento fallido no se da por terminado hasta que el puerto esta
      // cerrado de verdad: si no, el siguiente intento sobre ese mismo COM se
      // encuentra el manejador aun cogido y falla sin motivo real.
      if (!r.ok && s) { cerrarSocket(s).then(() => resolve(r)); return; }
      resolve(r);
    };

    try {
      s = new lib.SerialPort({ path: nombre, baudRate: BAUDIOS, autoOpen: false });
    } catch (e) {
      terminar({ ok: false, motivo: 'no_abre' });
      return;
    }

    s.on('error', () => terminar({ ok: false, motivo: 'no_abre' }));

    s.open((err) => {
      if (err) { terminar({ ok: false, motivo: 'no_abre' }); return; }

      // Se llama 'parser' y no 'lector' para no tapar a la variable de modulo
      // del mismo nombre: quien lea esto tiene que ver claro que el que se
      // guarda para toda la sesion es el de fuera, y que aqui solo se crea.
      const parser = s.pipe(new lib.ReadlineParser({ delimiter: '\n' }));
      parser.on('data', (linea) => {
        const t = String(linea).trim();
        if (t.startsWith(FIRMA)) terminar({ ok: true, socket: s, lector: parser, firma: t });
      });

      // Sin este reloj, una placa que abre el puerto pero no contesta nunca
      // dejaria la promesa colgada: exactamente el fallo que costo una tarde
      // en el sidecar de huella.
      relojes.push(setTimeout(
        () => terminar({ ok: false, motivo: 'no_responde' }),
        MS_BOOTLOADER + MS_RESPUESTA
      ));

      relojes.push(setTimeout(() => {
        try { s.write('PING\n'); } catch (e) { terminar({ ok: false, motivo: 'no_abre' }); }
      }, MS_BOOTLOADER));
    });
  });
}

// Cerrar un COM en Windows no es inmediato: close() vuelve enseguida pero el
// sistema tarda un instante en soltar el manejador, y mientras tanto cualquier
// intento de abrir ESE MISMO puerto falla con acceso denegado.
//
// Costo una ejecucion del diagnostico: detectar() cerraba el puerto, consultar()
// lo reabria en el acto y los dos primeros comandos salian 'no_abre' mientras el
// tercero, dos segundos despues, entraba bien. En la app se veria igual al pulsar
// "Buscar la placa" y enseguida "Abrir ahora".
const MS_ASENTAR = 250;

function cerrarSocket(s) {
  return new Promise((resolve) => {
    if (!s) { resolve(); return; }
    let hecho = false;
    const fin = () => {
      if (hecho) return;
      hecho = true;
      setTimeout(resolve, MS_ASENTAR);
    };
    // Si el callback de close() no llega -- puerto ya muerto, USB desenchufado --
    // esto no puede quedarse esperando para siempre.
    const reloj = setTimeout(fin, 800);
    try {
      s.close(() => { clearTimeout(reloj); fin(); });
    } catch (e) {
      clearTimeout(reloj);
      fin();
    }
  });
}

// Olvida el puerto YA (para que nadie le escriba) y devuelve la promesa del
// cierre de verdad, para quien necesite esperarla antes de reabrir.
function soltar() {
  const s = puerto;
  puerto = null;
  lector = null;
  nombreAbierto = null;
  return cerrarSocket(s);
}

async function asegurarConexion(nombreForzado) {
  const nombre = nombreForzado || leerConfig('puerta_puerto', null);
  if (!nombre) return { ok: false, motivo: 'sin_puerto' };

  // Aqui vivia un fallo feo, y lo cazo la suite con la placa ya conectada.
  //
  // Antes esto era `if (conectando) return conectando;` a secas, SIN mirar a que
  // puerto iba esa conexion en curso. Guardar la configuracion lanza una
  // reconexion en segundo plano; si mientras esta en vuelo alguien pide otro
  // puerto, se le devolvia el { ok: true } de la conexion vieja. El que pedia
  // COM199 se creia conectado y escribia sobre el socket de COM9 -- o sea, la
  // orden de abrir se iba a una placa distinta de la que se creia. Con un
  // electroiman detras, eso es abrir una puerta que nadie mando abrir.
  if (conectando && conectandoA === nombre) return conectando;
  if (conectando) { try { await conectando; } catch (e) { /* la de antes no es asunto nuestro */ } }

  if (puerto && puerto.isOpen && nombreAbierto === nombre) return { ok: true };
  if (nombreAbierto && nombreAbierto !== nombre) await soltar();

  // Dos pulsos seguidos (dos clientes a la vez) no pueden abrir el puerto dos
  // veces: el segundo se engancha a la conexion que ya esta en curso, que ahora
  // se sabe que es al mismo puerto.
  conectandoA = nombre;
  conectando = (async () => {
    const r = await abrirPuerto(nombre);
    if (!r.ok) {
      ultimoFallo = r.motivo;
      return { ok: false, motivo: r.motivo };
    }
    puerto = r.socket;
    lector = r.lector;
    nombreAbierto = nombre;
    ultimoFallo = null;
    // Un puerto cerrado o en error que siga guardado en la variable hace creer
    // a las siguientes llamadas que hay conexion, y write() sobre el descarta
    // en silencio. Se suelta en cuanto pasa cualquiera de las dos cosas.
    puerto.on('close', soltar);
    puerto.on('error', soltar);
    return { ok: true };
  })();

  // La promesa se limpia sola al acabar, y no en un finally del que llama: si
  // dos llamadas se enganchan a la misma, el finally del primero la borraria
  // mientras el segundo todavia la esta esperando.
  const enCurso = conectando;
  enCurso.then(limpiar, limpiar);
  function limpiar() {
    if (conectando === enCurso) { conectando = null; conectandoA = null; }
  }

  return enCurso;
}

// Recorre los puertos preguntando quien anda ahi. Los FTDI van primero porque
// es casi seguro que el nuestro es uno de esos.
//
// soloFtdi lo usa la redeteccion automatica, la que corre sola cuando falla un
// pulso. Sondear un puerto cuesta hasta 3,2 s, asi que recorrer los seis COM de
// una maquina con impresora fiscal y lector de codigos dejaria al cliente medio
// minuto mirando el kiosco. El boton "Buscar la placa", que lo pulsa alguien a
// proposito y puede esperar, si los recorre todos.
async function detectar(soloFtdi) {
  let candidatos = await listarPuertos();
  if (soloFtdi) candidatos = candidatos.filter(c => c.esFtdi);
  if (candidatos.length === 0) return { ok: false, motivo: 'sin_puertos' };

  // Se guarda POR QUE fallo cada puerto. Sin esto, el unico motivo posible era
  // 'ninguno_responde', y el diagnostico decia "falta grabarle el sketch" tanto
  // si la placa estaba muda como si el puerto lo tenia cogido otro programa --
  // mandando a rehacer la grabacion cuando bastaba con cerrar el Monitor Serie.
  const porQue = [];

  for (const c of candidatos) {
    if (nombreAbierto === c.puerto && puerto && puerto.isOpen) {
      return { ok: true, puerto: c.puerto, firma: FIRMA, porQue };
    }
    const r = await abrirPuerto(c.puerto);
    if (r.ok) {
      // Se espera al cierre de verdad antes de contestar. Quien llama a esto
      // casi siempre quiere abrir ese mismo puerto a continuacion -- el boton
      // "Buscar la placa" y luego "Abrir ahora", o el propio diagnostico -- y
      // sin la espera se encuentra el COM todavia cogido por nosotros mismos.
      await cerrarSocket(r.socket);
      return { ok: true, puerto: c.puerto, firma: r.firma, porQue };
    }
    porQue.push({ puerto: c.puerto, motivo: r.motivo });
  }

  // Si algun puerto ni siquiera se dejo abrir, ese es el motivo util: no es lo
  // mismo "esta ocupado" que "no hay nadie ahi".
  const ocupado = porQue.some(x => x.motivo === 'no_abre');
  return { ok: false, motivo: ocupado ? 'puerto_ocupado' : 'ninguno_responde', porQue };
}

// ------------------------------------------------------------------- pulso

// Manda la orden y vuelve. NO espera los 5 segundos: el cliente esta delante
// del kiosco y la pantalla tiene que contestarle ya. Los segundos los cuenta
// la placa.
async function pulso(puertoForzado) {
  const segundos = segundosConfigurados();

  let con = await asegurarConexion(puertoForzado);

  // El numero de COM que Windows le asigna a un USB no es eterno: cambia al
  // enchufarlo en otro puerto, y despues de algunas actualizaciones. Antes de
  // dar fallo, se busca la placa por ahi y, si aparece, se apunta el nuevo COM
  // para no volver a buscarla manana.
  // 'sin_puerto' queda fuera a proposito: si nunca se ha elegido puerto, lo que
  // toca es que alguien pulse "Buscar la placa" una vez en Configuracion, no que
  // el kiosco se ponga a sondear COM en mitad de una entrada.
  if (!con.ok && !puertoForzado && con.motivo !== 'sin_modulo' && con.motivo !== 'sin_puerto') {
    const hallada = await detectar(true);
    if (hallada.ok) {
      escribirConfig('puerta_puerto', hallada.puerto);
      con = await asegurarConexion(hallada.puerto);
    }
  }

  if (!con.ok) return { ok: false, motivo: con.motivo };

  try {
    puerto.write('ABRIR:' + (segundos * 1000) + '\n');
  } catch (e) {
    soltar();
    ultimoFallo = 'escritura_fallida';
    return { ok: false, motivo: 'escritura_fallida' };
  }
  return { ok: true, segundos };
}

// Manda una orden y devuelve la primera linea que conteste la placa.
//
// El kiosco NO usa esto: abrir la puerta no puede depender de que llegue una
// respuesta, porque entonces una placa muda dejaria al cliente esperando. Esto
// es para el diagnostico, que es justo donde si hace falta oir a la placa para
// poder decir "cerro sola" en vez de "mande la orden y ya veremos".
async function consultar(orden, ms, puertoForzado) {
  // El puerto explicito importa: el diagnostico corre ANTES de que nadie haya
  // elegido puerto en Configuracion, asi que tiene que poder hablarle a la
  // placa que acaba de encontrar sin depender de lo que haya en la base.
  const con = await asegurarConexion(puertoForzado);
  if (!con.ok) return { ok: false, motivo: con.motivo };
  if (!lector) return { ok: false, motivo: 'sin_lector' };

  return new Promise((resolve) => {
    let listo = false;
    const acabar = (r) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      lector.removeListener('data', alLlegar);
      resolve(r);
    };
    const alLlegar = (linea) => acabar({ ok: true, respuesta: String(linea).trim() });
    const reloj = setTimeout(() => acabar({ ok: false, motivo: 'sin_respuesta' }), ms || 2500);

    lector.on('data', alLlegar);
    try { puerto.write(orden + '\n'); } catch (e) { acabar({ ok: false, motivo: 'escritura_fallida' }); }
  });
}

// Lo que llama el kiosco cuando alguien SI puede entrenar. Devuelve una
// etiqueta corta para la pantalla; nunca lanza.
//
// El tope de tiempo es lo importante de esta funcion. Con el puerto ya abierto
// mandar la orden tarda milisegundos, pero si la placa se habia desconectado,
// pulso() intenta reconectar (2,2 s de reset) y hasta recorrer los COM
// buscandola. Eso no puede congelar el kiosco con un cliente delante: pasado el
// tope se contesta 'abriendo' y el intento sigue por su cuenta -- si acaba
// saliendo bien, la puerta se abre un segundo despues, y quien quedo conectado
// es el siguiente que marque.
const MS_ESPERA_KIOSCO = 1500;

async function abrirSiProcede() {
  if (!estaActiva()) return 'desactivada';

  let reloj;
  const aDestiempo = new Promise((r) => { reloj = setTimeout(() => r('abriendo'), MS_ESPERA_KIOSCO); });

  try {
    const intento = pulso().then(r => (r.ok ? 'abierta' : 'fallo'), () => 'fallo');
    return await Promise.race([intento, aDestiempo]);
  } catch (e) {
    return 'fallo';
  } finally {
    clearTimeout(reloj);
  }
}

// ------------------------------------------------------------------ estado

function estado() {
  const lib = libreria();
  return {
    activa: estaActiva(),
    puerto: leerConfig('puerta_puerto', null),
    segundos: segundosConfigurados(),
    conectada: !!(puerto && puerto.isOpen),
    moduloOk: !!lib,
    moduloFallo,
    ultimoFallo,
  };
}

// Al arrancar la app se conecta en segundo plano, si la puerta esta activada.
// Asi los 2,2 s del reset de la placa se pagan una vez, mientras nadie mira, y
// no se los come el primer cliente de la manana.
function arrancar() {
  if (!estaActiva()) return;
  asegurarConexion().catch(() => {});
}

// Devuelve la promesa del cierre real, no una ya resuelta: quien cierra suele
// ser para reabrir (guardar la configuracion con otro puerto) o para dejarle el
// COM al IDE de Arduino, y en los dos casos importa que este libre de verdad.
function cerrar() {
  return soltar();
}

module.exports = {
  listarPuertos, detectar, pulso, consultar, abrirSiProcede, estado, arrancar, cerrar,
  SEGUNDOS_MIN, SEGUNDOS_MAX, SEGUNDOS_POR_DEFECTO,
};
