const { format, differenceInCalendarDays, parseISO } = require('date-fns');
const { getDb } = require('../db/connection');
const { obtenerDekEnMemoria } = require('../crypto/dek');
const correo = require('./correo');
const { construirHtml } = require('./plantillaCorreo');

// Recordatorios de vencimiento por correo.
//
// Cada quince dias la app mira quien tiene la membresia vencida o a punto de
// vencer, y le escribe. Es lo mas parecido que tiene un gimnasio a un vendedor:
// el que se cayo hace tres semanas no vuelve porque se le olvido, no porque se
// haya ido.
//
// Tres decisiones que gobiernan todo lo de aqui:
//
//   1. Un correo por persona, con su nombre y su fecha. Nada de una copia oculta
//      con setenta direcciones: eso se lee como publicidad y no dice nada.
//   2. Pausa entre envio y envio. Setenta conexiones SMTP en cinco segundos es
//      justo el patron que Google marca como robot.
//   3. Nada de reenviar. Lo que ya salio queda anotado, y abrir la app tres
//      veces el mismo dia no vuelve a escribir a nadie.

const PAUSA_MS = 3000;   // entre un correo y el siguiente
const CADA_MS = 30 * 60 * 1000; // cada cuanto se pregunta si toca ronda

const DEFECTOS = {
  recordatorios_activo: '0',
  recordatorios_cada_dias: '15',
  recordatorios_incluye_por_vencer: '1',
  recordatorios_remitente: '',
  recordatorios_html: '1',
  recordatorios_logo: '1',
  recordatorios_color: '#ffe500',
  recordatorios_nombre_remitente: '',
  recordatorios_ultima_ronda: '',
  recordatorios_asunto_vencida: 'Tu membresía en {gimnasio} ya venció',
  recordatorios_cuerpo_vencida:
    'Hola {nombre},\n\n' +
    'Tu membresía ({plan}) venció el {fecha}, hace {dias} días.\n\n' +
    'Pásate por recepción cuando quieras y la renovamos en un minuto. ' +
    'Te esperamos.\n\n' +
    '{gimnasio}',
  recordatorios_asunto_por_vencer: 'Tu membresía en {gimnasio} está por vencer',
  recordatorios_cuerpo_por_vencer:
    'Hola {nombre},\n\n' +
    'Tu membresía ({plan}) vence el {fecha}: te quedan {dias} días.\n\n' +
    'Si quieres renovarla sin quedarte fuera ni un día, pásate por recepción.\n\n' +
    '{gimnasio}',
};

function hoyLocal() {
  return format(new Date(), 'yyyy-MM-dd');
}

// Dominios que existen para no existir: son los que la norma reserva para
// ejemplos y pruebas. Un Excel de clientes lleno de "@example.com" no es raro --
// sale asi de cualquier generador de datos de muestra -- y mandarles la ronda
// significa sesenta rebotes seguidos contra un dominio inexistente, que es una
// de las cosas que peor le sientan a la reputacion de una cuenta de correo.
const DOMINIOS_FALSOS = ['example.com', 'example.org', 'example.net', 'test', 'invalid', 'localhost'];

// Que un correo sea utilizable no es lo mismo que "tiene arroba".
//
// Las tildes y las enes se cuelan al escribir a mano o al generar direcciones a
// partir del nombre, y el SMTP de toda la vida no las acepta: ese correo no
// rebota, es que no sale. Vale mas detectarlo aqui y decir a quien hay que
// arreglarle la direccion.
function revisarCorreo(email) {
  const texto = String(email || '').trim();
  if (!texto) return 'vacio';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) return 'mal_escrito';
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(texto)) return 'con_tildes';
  if (DOMINIOS_FALSOS.includes(texto.split('@')[1].toLowerCase())) return 'dominio_de_ejemplo';
  return null;
}

function leerConfig() {
  const db = getDb();
  const config = { ...DEFECTOS };
  for (const clave of Object.keys(DEFECTOS)) {
    const fila = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
    if (fila) config[clave] = fila.valor;
  }
  return {
    activo: config.recordatorios_activo === '1',
    cadaDias: Math.max(1, parseInt(config.recordatorios_cada_dias, 10) || 15),
    incluyePorVencer: config.recordatorios_incluye_por_vencer === '1',
    remitente: config.recordatorios_remitente,
    nombreRemitente: config.recordatorios_nombre_remitente,
    html: config.recordatorios_html === '1',
    logo: config.recordatorios_logo === '1',
    color: config.recordatorios_color,
    ultimaRonda: config.recordatorios_ultima_ronda || null,
    plantillas: {
      vencida: { asunto: config.recordatorios_asunto_vencida, cuerpo: config.recordatorios_cuerpo_vencida },
      por_vencer: { asunto: config.recordatorios_asunto_por_vencer, cuerpo: config.recordatorios_cuerpo_por_vencer },
    },
    hayPassword: correo.hayPassword(),
  };
}

function guardarConfig(cambios) {
  const mapa = {
    activo: ['recordatorios_activo', (v) => (v ? '1' : '0')],
    cadaDias: ['recordatorios_cada_dias', (v) => String(v)],
    incluyePorVencer: ['recordatorios_incluye_por_vencer', (v) => (v ? '1' : '0')],
    remitente: ['recordatorios_remitente', (v) => String(v || '').trim()],
    nombreRemitente: ['recordatorios_nombre_remitente', (v) => String(v || '').trim()],
    html: ['recordatorios_html', (v) => (v ? '1' : '0')],
    logo: ['recordatorios_logo', (v) => (v ? '1' : '0')],
    color: ['recordatorios_color', (v) => String(v || '#ffe500')],
    asuntoVencida: ['recordatorios_asunto_vencida', String],
    cuerpoVencida: ['recordatorios_cuerpo_vencida', String],
    asuntoPorVencer: ['recordatorios_asunto_por_vencer', String],
    cuerpoPorVencer: ['recordatorios_cuerpo_por_vencer', String],
  };

  const estabaActivo = leerConfig().activo;

  for (const [campo, valor] of Object.entries(cambios || {})) {
    if (!mapa[campo] || valor === undefined) continue;
    const [clave, convertir] = mapa[campo];
    correo.setConfig(clave, convertir(valor));
  }

  // La primera vez que se activa, la cuenta arranca hoy.
  //
  // Sin esto, "nunca ha habido ronda" significa "toca ya", y el vigilante
  // mandaria la primera tanda entera -- que en un gimnasio en marcha son setenta
  // correos a setenta personas de verdad -- a los pocos minutos de marcar la
  // casilla, sin que nadie haya visto un solo correo. Activar tiene que ser
  // inofensivo: la primera ronda se manda a mano, con el boton, cuando ya se ha
  // mirado la lista.
  const ahoraActivo = leerConfig().activo;
  if (ahoraActivo && !estabaActivo && !leerConfig().ultimaRonda) {
    correo.setConfig('recordatorios_ultima_ronda', hoyLocal());
  }

  return { ok: true };
}

function nombreGimnasio() {
  return datosGimnasio().nombre;
}

function datosGimnasio() {
  const db = getDb();
  const leer = (clave) => {
    const fila = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
    return fila ? fila.valor : '';
  };
  return {
    nombre: leer('gym_nombre') || 'el gimnasio',
    direccion: leer('gym_direccion'),
    telefono: leer('gym_telefono'),
  };
}

// El logo va incrustado en el propio correo (cid), no enlazado a una direccion
// de internet. No hay ningun servidor donde alojarlo -- la app vive en el PC de
// recepcion -- y ademas un <img> que apunta a fuera lo bloquean casi todos los
// clientes de correo hasta que el lector pulsa "mostrar imagenes".
//
// Sale de la misma tabla cifrada que el resto de imagenes de la app, asi que
// requiere la base abierta. Si no hay logo, no pasa nada: el correo se manda sin
// el, con el nombre del gimnasio de cabecera.
function logoDelGimnasio() {
  try {
    const dataUrl = require('./imagenes').obtener('gimnasio', null);
    if (!dataUrl) return null;
    const coincide = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!coincide) return null;
    return { mime: coincide[1], buffer: Buffer.from(coincide[2], 'base64'), dataUrl };
  } catch (e) {
    return null;
  }
}

// Arma el mensaje completo -- texto plano y, si toca, su version HTML -- para un
// destinatario. Se usa igual al enviar y al previsualizar; que sean el mismo
// codigo es lo que hace que la vista previa valga de algo.
function componerMensaje({ destino, config, gimnasio, logo, paraPantalla = false }) {
  const plantilla = config.plantillas[destino.tipo];
  const asunto = rellenar(plantilla.asunto, destino, gimnasio.nombre);
  const texto = rellenar(plantilla.cuerpo, destino, gimnasio.nombre);

  if (!config.html) return { asunto, texto, html: null, adjuntos: [] };

  const usaLogo = config.logo && !!logo;
  const html = construirHtml({
    cuerpo: texto,
    gimnasio: gimnasio.nombre,
    direccion: gimnasio.direccion,
    telefono: gimnasio.telefono,
    color: config.color,
    titulo: asunto,
    logoSrc: usaLogo ? (paraPantalla ? logo.dataUrl : 'cid:logo-gimnasio') : null,
  });

  const adjuntos = usaLogo && !paraPantalla
    ? [{ filename: 'logo' + (logo.mime === 'image/png' ? '.png' : '.jpg'),
         content: logo.buffer, contentType: logo.mime, cid: 'logo-gimnasio' }]
    : [];

  // El texto plano se manda SIEMPRE junto al HTML. Es lo que ve quien tiene el
  // correo en modo texto, lo que leen los filtros de spam para decidir, y lo que
  // queda si el HTML no se pinta.
  return { asunto, texto, html, adjuntos };
}

// Quien deberia recibir correo, con el mismo criterio de "vencida" que usan el
// kiosco y la pantalla de Clientes: se reutiliza cargarEstados() en vez de
// escribir aqui otra definicion que dejaria de coincidir a la primera.
// `repetir` es la excepcion al freno de "no repetir": deja volver a escribirle a
// quien ya recibio el aviso en este periodo. Solo se usa cuando alguien lo pide a
// mano desde Configuracion -- la ronda automatica nunca lo activa --, porque el
// freno existe para que abrir la app dos veces no mande dos correos, no para
// impedir un reenvio que se quiere de verdad.
function destinatarios({ incluyePorVencer = true, cadaDias = 15 } = {}, { repetir = false } = {}) {
  const db = getDb();
  const { cargarEstados } = require('../db/repos/panel-clientes');
  const { elegirMembresiaGobernante } = require('./membresias-logica');

  const estados = cargarEstados();
  const clientes = db.prepare(
    'SELECT id, nombre, email, telefono FROM clientes WHERE activo = 1'
  ).all();

  const hoy = hoyLocal();
  const elegidos = [];
  const sinCorreo = [];
  const correoInvalido = [];

  for (const cliente of clientes) {
    const gobernante = elegirMembresiaGobernante(estados.get(cliente.id) || []);
    if (!gobernante) continue;

    // 'agotada' es una ticketera sin tiquetes: para el cliente es lo mismo que
    // estar vencido -- hoy no puede entrar -- y es igual de buen momento para
    // recordarselo.
    let tipo = null;
    if (gobernante.estado === 'vencida' || gobernante.estado === 'agotada') tipo = 'vencida';
    else if (incluyePorVencer && gobernante.estado === 'por_vencer') tipo = 'por_vencer';
    if (!tipo) continue;

    const email = String(cliente.email || '').trim();
    const destino = {
      clienteId: cliente.id,
      membresiaId: gobernante.id,
      nombre: cliente.nombre,
      email,
      telefono: cliente.telefono,
      plan: gobernante.plan_nombre,
      fFin: gobernante.f_fin,
      tipo,
      dias: gobernante.f_fin
        ? Math.abs(differenceInCalendarDays(parseISO(gobernante.f_fin), parseISO(hoy)))
        : null,
    };

    // Sin correo no hay nada que hacer, pero tienen que salir listados: son a los
    // que hay que llamar por telefono.
    const problema = revisarCorreo(email);
    if (problema === 'vacio') { sinCorreo.push(destino); continue; }
    if (problema) { correoInvalido.push({ ...destino, problema }); continue; }

    // Ya se le escribio dentro del periodo: no se repite. Este es el freno que
    // evita que abrir la app dos veces el mismo dia mande dos correos.
    const reciente = db.prepare(`
      SELECT 1 FROM recordatorios_enviados
      WHERE cliente_id = ? AND tipo = ? AND ok = 1
        AND fecha >= date('now', 'localtime', ?)
    `).get(cliente.id, tipo, '-' + cadaDias + ' days');
    if (reciente) { destino.yaAvisado = true; elegidos.push(destino); continue; }

    elegidos.push(destino);
  }

  elegidos.sort((a, b) => a.nombre.localeCompare(b.nombre));
  sinCorreo.sort((a, b) => a.nombre.localeCompare(b.nombre));
  correoInvalido.sort((a, b) => a.nombre.localeCompare(b.nombre));

  // Al repetir, los ya avisados siguen marcados (la pantalla dice cuantos son) pero
  // entran en la ronda.
  return {
    repetir,
    porEnviar: repetir ? elegidos : elegidos.filter(d => !d.yaAvisado),
    yaAvisados: elegidos.filter(d => d.yaAvisado),
    sinCorreo,
    correoInvalido,
  };
}

// Cuantos clientes tienen un correo al que de verdad se le pueda escribir, sobre
// TODOS los activos y no solo sobre los que hoy toca avisar.
//
// destinatarios() mira unicamente a quien tiene la membresia vencida o por
// vencer: sirve para la ronda, pero no responde a "cuantos correos me quedan por
// conseguir", que es lo que hay que saber ANTES de salir a pedirlos. Hasta ahora
// eso habia que mirarlo cliente a cliente en la lista.
//
// El criterio es el mismo revisarCorreo() que decide si se manda o no, para que
// el numero de aqui y el de la ronda no puedan discrepar.
function censoCorreos() {
  const db = getDb();
  const clientes = db.prepare(`
    SELECT id, documento, nombre, email, telefono FROM clientes WHERE activo = 1 ORDER BY nombre
  `).all();

  const censo = {
    total: clientes.length,
    utilizables: 0,
    vacio: [], dominio_de_ejemplo: [], mal_escrito: [], con_tildes: [],
  };

  for (const c of clientes) {
    const problema = revisarCorreo(c.email);
    if (!problema) { censo.utilizables++; continue; }
    censo[problema].push({
      clienteId: c.id, documento: c.documento, nombre: c.nombre,
      email: String(c.email || '').trim(), telefono: c.telefono,
    });
  }

  censo.porConseguir = censo.total - censo.utilizables;
  return censo;
}

function rellenar(plantilla, destino, gimnasio) {
  return String(plantilla || '')
    .replace(/\{nombre\}/g, destino.nombre)
    .replace(/\{plan\}/g, destino.plan || 'tu plan')
    .replace(/\{fecha\}/g, destino.fFin || 'sin fecha')
    .replace(/\{dias\}/g, destino.dias == null ? '' : String(destino.dias))
    .replace(/\{gimnasio\}/g, gimnasio);
}

function anotar({ clienteId, membresiaId, tipo, email, ok, error }) {
  getDb().prepare(`
    INSERT INTO recordatorios_enviados (cliente_id, membresia_id, tipo, email, fecha, ok, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(clienteId, membresiaId || null, tipo, email, new Date().toISOString(), ok ? 1 : 0, error || null);
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// Manda la ronda. Devuelve siempre, tambien si todo falla: quien la lanzo tiene
// que poder ver que paso, y una excepcion a medio camino dejaria media lista
// enviada y sin explicacion.
// Una ronda a la vez. La lista de a quien escribir se calcula al empezar y lo
// enviado se anota correo a correo, asi que dos rondas solapadas -- el boton
// "Enviar ahora" mientras corre la automatica, o dos clics seguidos -- le
// mandan DOS correos iguales a cada cliente, que es la forma mas rapida de que
// marquen el remitente como spam.
let rondaEnCurso = false;

async function enviarRonda({ manual = false, repetir = false } = {}) {
  const config = leerConfig();
  if (!obtenerDekEnMemoria()) return { ok: false, motivo: 'cifrado_cerrado' };
  if (!config.remitente) return { ok: false, motivo: 'sin_remitente' };

  const password = correo.leerPassword();
  if (!password) return { ok: false, motivo: 'sin_password' };

  if (rondaEnCurso) return { ok: false, motivo: 'ronda_en_curso' };
  rondaEnCurso = true;
  try {
    return await enviarRondaDeVerdad({ manual, repetir, config, password });
  } finally {
    rondaEnCurso = false;
  }
}

async function enviarRondaDeVerdad({ manual, repetir, config, password }) {

  // Repetir solo vale si lo pidio una persona. La ronda automatica que corre al
  // abrir la app no puede reenviar nunca: seria el envio doble que el freno evita.
  const repitiendo = manual && repetir;
  const lista = destinatarios(config, { repetir: repitiendo });
  const gimnasio = datosGimnasio();
  const logo = logoDelGimnasio();
  const transporte = correo.crearTransporte({ remitente: config.remitente, password });

  const resultado = {
    ok: true, manual, repetir: repitiendo,
    enviados: 0, fallidos: 0,
    sinCorreo: lista.sinCorreo.length,
    correoInvalido: lista.correoInvalido.length,
    yaAvisados: lista.yaAvisados.length,
    errores: [],
  };

  try {
    for (const destino of lista.porEnviar) {
      const mensaje = componerMensaje({ destino, config, gimnasio, logo });
      try {
        await transporte.sendMail({
          from: config.nombreRemitente
            ? `"${config.nombreRemitente}" <${config.remitente}>`
            : config.remitente,
          to: destino.email,
          subject: mensaje.asunto,
          text: mensaje.texto,
          ...(mensaje.html ? { html: mensaje.html } : {}),
          ...(mensaje.adjuntos.length ? { attachments: mensaje.adjuntos } : {}),
        });
        anotar({ ...destino, ok: true });
        resultado.enviados++;
      } catch (e) {
        const motivo = correo.traducirError(e);
        anotar({ ...destino, ok: false, error: motivo });
        resultado.fallidos++;
        resultado.errores.push({ nombre: destino.nombre, email: destino.email, motivo });
      }

      // La pausa va entre correos, no despues del ultimo.
      if (destino !== lista.porEnviar[lista.porEnviar.length - 1]) await esperar(PAUSA_MS);
    }
  } finally {
    transporte.close();
  }

  // La fecha de la ronda se guarda aunque no se haya enviado nada: si hoy no
  // habia vencidos, la siguiente sigue siendo dentro de quince dias y no manana.
  correo.setConfig('recordatorios_ultima_ronda', hoyLocal());

  getDb().prepare(`
    INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
    VALUES (NULL, ?, 'recordatorios', NULL, ?, ?)
  `).run(manual ? 'recordatorios_manual' : 'recordatorios_automatico',
         new Date().toISOString(),
         JSON.stringify({ enviados: resultado.enviados, fallidos: resultado.fallidos, sinCorreo: resultado.sinCorreo,
                          repetir: repitiendo, yaAvisados: resultado.yaAvisados }));

  return resultado;
}

async function enviarPrueba() {
  const config = leerConfig();
  if (!config.remitente) return { ok: false, motivo: 'sin_remitente' };
  const password = correo.leerPassword();
  if (!password) return { ok: false, motivo: 'sin_password' };

  const transporte = correo.crearTransporte({ remitente: config.remitente, password });
  const gimnasio = datosGimnasio();
  const logo = logoDelGimnasio();
  const ejemplo = {
    nombre: 'Cliente de prueba', plan: 'Mensual',
    fFin: format(new Date(Date.now() - 3 * 86400000), 'yyyy-MM-dd'),
    dias: 3, tipo: 'vencida',
  };

  const mensaje = componerMensaje({ destino: ejemplo, config, gimnasio, logo });

  try {
    await transporte.sendMail({
      from: config.nombreRemitente ? `"${config.nombreRemitente}" <${config.remitente}>` : config.remitente,
      to: config.remitente, // a uno mismo: la prueba no puede caerle a un cliente
      subject: '[PRUEBA] ' + mensaje.asunto,
      text: mensaje.texto,
      ...(mensaje.html ? { html: mensaje.html } : {}),
      ...(mensaje.adjuntos.length ? { attachments: mensaje.adjuntos } : {}),
    });
    return { ok: true, destino: config.remitente, conLogo: mensaje.adjuntos.length > 0 };
  } catch (e) {
    return { ok: false, motivo: correo.traducirError(e) };
  } finally {
    transporte.close();
  }
}

// Lo que se pinta en Configuracion al pulsar "ver como queda". Usa exactamente
// la misma funcion que el envio, con el logo como data URL en vez de adjunto.
function vistaPrevia(tipo = 'vencida') {
  const config = leerConfig();
  const gimnasio = datosGimnasio();
  const logo = logoDelGimnasio();
  const ejemplo = {
    nombre: 'Carolina Ríos', plan: 'Mensual',
    fFin: format(new Date(Date.now() - 3 * 86400000), 'yyyy-MM-dd'),
    dias: 3, tipo: tipo === 'por_vencer' ? 'por_vencer' : 'vencida',
  };
  const mensaje = componerMensaje({ destino: ejemplo, config, gimnasio, logo, paraPantalla: true });
  return { ok: true, asunto: mensaje.asunto, texto: mensaje.texto, html: mensaje.html, hayLogo: !!logo };
}

function diasDesdeUltimaRonda(config) {
  if (!config.ultimaRonda) return null;
  return differenceInCalendarDays(parseISO(hoyLocal()), parseISO(config.ultimaRonda));
}

function tocaRonda(config) {
  if (!config.activo) return false;
  const dias = diasDesdeUltimaRonda(config);
  return dias === null || dias >= config.cadaDias;
}

function proximaRonda(config) {
  if (!config.ultimaRonda) return 'en cuanto se active y haya alguien a quien avisar';
  const dias = config.cadaDias - (diasDesdeUltimaRonda(config) || 0);
  if (dias <= 0) return 'en el próximo arranque de la app';
  return 'en ' + dias + (dias === 1 ? ' día' : ' días');
}

function historial(limite = 50) {
  return getDb().prepare(`
    SELECT r.fecha, r.tipo, r.email, r.ok, r.error, c.nombre
    FROM recordatorios_enviados r
    LEFT JOIN clientes c ON c.id = r.cliente_id
    ORDER BY r.fecha DESC, r.id DESC LIMIT ?
  `).all(Math.min(Number(limite) || 50, 500));
}

// El vigilante. Pregunta cada media hora si toca, y casi siempre la respuesta es
// que no: es barato y no depende de que la app se abra a una hora concreta.
//
// Esto es lo que resuelve el problema de fondo de un "cada 15 dias" en una app de
// escritorio: el PC del gimnasio puede estar apagado justo ese dia. Como lo que
// se mira es "cuantos dias han pasado desde la ultima ronda" y no "es hoy martes",
// una ronda que caia en un dia cerrado sale en cuanto vuelven a abrir.
let temporizador = null;

async function revisar() {
  try {
    if (!obtenerDekEnMemoria()) return; // nadie ha entrado todavia
    const config = leerConfig();
    if (!tocaRonda(config)) return;
    if (!config.remitente || !correo.hayPassword()) return;

    const r = await enviarRonda({ manual: false });
    if (r.ok) console.log('Recordatorios enviados:', r.enviados, '/ fallidos:', r.fallidos);
  } catch (e) {
    console.error('La ronda de recordatorios fallo:', e.message);
  }
}

function iniciarProgramador() {
  if (temporizador) return;
  temporizador = setInterval(revisar, CADA_MS);
  // La primera revision no es inmediata: al arrancar todavia no hay nadie dentro
  // y el cifrado esta cerrado, asi que no habria DEK con que leer la contrasena.
  setTimeout(revisar, 60 * 1000);
}

function pararProgramador() {
  if (temporizador) { clearInterval(temporizador); temporizador = null; }
}

module.exports = {
  DEFECTOS, PAUSA_MS, DOMINIOS_FALSOS, revisarCorreo,
  leerConfig, guardarConfig, destinatarios, censoCorreos, enviarRonda, enviarPrueba,
  historial, tocaRonda, proximaRonda, diasDesdeUltimaRonda,
  componerMensaje, vistaPrevia, datosGimnasio, logoDelGimnasio,
  iniciarProgramador, pararProgramador, revisar, rellenar,
};
