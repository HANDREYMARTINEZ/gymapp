const nodemailer = require('nodemailer');
const { getDb } = require('../db/connection');
const { obtenerDekEnMemoria, cifrarBuffer, descifrarBuffer } = require('../crypto/dek');

// Envio de correo por SMTP. Solo lo usan los recordatorios de vencimiento.
//
// La contrasena NO es la del correo: Gmail exige una "contrasena de aplicacion",
// que se genera aparte y solo sirve para esto. Si un dia se filtra el gym.db, esa
// clave abre el buzon para mandar, no la cuenta de Google entera.
//
// Aun asi se guarda cifrada con la DEK, igual que las fotos y las huellas: es el
// unico secreto de la app que sale a internet, y dejarlo en claro en una tabla
// que se copia en cada respaldo seria regalarlo.

const CLAVE_PASS = 'recordatorios_smtp_pass';

function getConfig(clave) {
  const fila = getDb().prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
  return fila ? fila.valor : null;
}

function setConfig(clave, valor) {
  getDb().prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  ).run(clave, valor);
}

function guardarPassword(passwordEnClaro) {
  const dek = obtenerDekEnMemoria();
  if (!dek) return { ok: false, motivo: 'cifrado_cerrado' };

  const texto = String(passwordEnClaro || '').replace(/\s/g, ''); // Google la muestra en grupos de 4
  if (!texto) {
    getDb().prepare('DELETE FROM config WHERE clave = ?').run(CLAVE_PASS);
    return { ok: true, borrada: true };
  }

  setConfig(CLAVE_PASS, cifrarBuffer(Buffer.from(texto, 'utf-8'), dek).toString('base64'));
  return { ok: true };
}

function hayPassword() {
  return !!getConfig(CLAVE_PASS);
}

function leerPassword() {
  const guardada = getConfig(CLAVE_PASS);
  if (!guardada) return null;
  const dek = obtenerDekEnMemoria();
  if (!dek) return null;
  try {
    return descifrarBuffer(Buffer.from(guardada, 'base64'), dek).toString('utf-8');
  } catch (e) {
    return null;
  }
}

// Se crea uno por ronda y se cierra al terminar. Mantenerlo abierto entre rondas
// -- que son cada quince dias -- solo serviria para que la conexion caducara sin
// que nadie se entere.
function crearTransporte({ remitente, password }) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: remitente, pass: password },
    pool: true,
    maxConnections: 1,
  });
}

async function verificar({ remitente, password }) {
  const transporte = crearTransporte({ remitente, password });
  try {
    await transporte.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: traducirError(e) };
  } finally {
    transporte.close();
  }
}

// Los errores de nodemailer vienen en ingles y con codigos de Google. Quien lee
// esto esta en un mostrador, no depurando SMTP.
function traducirError(e) {
  const texto = String(e && e.message ? e.message : e);
  if (/Invalid login|Username and Password not accepted|BadCredentials/i.test(texto)) {
    return 'Google rechazó el usuario o la contraseña. Recuerda que tiene que ser una contraseña de aplicación, no la del correo.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ENETUNREACH/i.test(texto)) {
    return 'No hay conexión a internet, o el antivirus está bloqueando la salida.';
  }
  if (/Daily user sending (limit|quota) exceeded|550-5\.4\.5/i.test(texto)) {
    return 'Google no acepta más correos por hoy. Vuelve a intentarlo mañana.';
  }
  return texto;
}

module.exports = {
  CLAVE_PASS, getConfig, setConfig,
  guardarPassword, hayPassword, leerPassword,
  crearTransporte, verificar, traducirError,
};
