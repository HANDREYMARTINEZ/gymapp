const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { app } = require('electron');
const { obtenerDekEnMemoria, cifrarBuffer } = require('../crypto/dek');
const AdmZip = require('adm-zip');
const { descifrarBuffer } = require('../crypto/dek');
const { getDb } = require('../db/connection');

const MAX_RESPALDOS = 14; // ~2 semanas si se genera uno por día

// Los .gymbak nuevos empiezan por esta marca y siguen en binario. Los de la
// primera version eran el hexadecimal a secas, sin marca, asi que la marca es lo
// que permite leer los dos: un respaldo viejo tiene que seguir restaurandose,
// porque puede ser el unico que quede el dia que haga falta.
const MARCA = Buffer.from('GYMBAK1:', 'utf-8');

function pareceFormatoNuevo(buffer) {
  return buffer.length > MARCA.length && buffer.subarray(0, MARCA.length).equals(MARCA);
}

function carpetaRespaldosDefault() {
  return path.join(app.getPath('userData'), 'respaldos');
}

function comprimirArchivo(rutaArchivo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    archive.file(rutaArchivo, { name: 'gym.db' });
    archive.finalize();
  });
}

// La base corre en WAL, asi que las transacciones recientes viven en gym.db-wal
// y no en gym.db. Comprimir gym.db a secas dejaria fuera lo ultimo escrito.
// db.backup() escribe un snapshot consistente que ya incluye el WAL.
async function comprimirDb() {
  const rutaSnapshot = path.join(
    app.getPath('temp'),
    `gym-snapshot-${process.pid}-${Date.now()}.db`
  );

  await getDb().backup(rutaSnapshot);
  try {
    return await comprimirArchivo(rutaSnapshot);
  } finally {
    fs.rmSync(rutaSnapshot, { force: true });
  }
}

async function generarRespaldo(carpetaDestino) {
  const dek = obtenerDekEnMemoria();
  if (!dek) {
    throw new Error('No se puede respaldar: la app no está desbloqueada (falta la passphrase de esta sesión)');
  }

  const destino = carpetaDestino || carpetaRespaldosDefault();
  fs.mkdirSync(destino, { recursive: true });

  const zipBuffer = await comprimirDb();
  const cifrado = cifrarBuffer(zipBuffer, dek);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nombreArchivo = `respaldo-${timestamp}.gymbak`;
  const rutaCompleta = path.join(destino, nombreArchivo);

  fs.writeFileSync(rutaCompleta, Buffer.concat([MARCA, cifrado]));

  rotarRespaldos(destino);

  return { ok: true, ruta: rutaCompleta };
}

function rotarRespaldos(carpeta) {
  const archivos = fs.readdirSync(carpeta)
    .filter(f => f.endsWith('.gymbak'))
    .map(f => ({ nombre: f, ruta: path.join(carpeta, f), tiempo: fs.statSync(path.join(carpeta, f)).mtimeMs }))
    .sort((a, b) => b.tiempo - a.tiempo);

  const sobrantes = archivos.slice(MAX_RESPALDOS);
  for (const viejo of sobrantes) {
    fs.unlinkSync(viejo.ruta);
  }
}

function listarRespaldos(carpetaDestino) {
  const destino = carpetaDestino || carpetaRespaldosDefault();
  if (!fs.existsSync(destino)) return [];
  return fs.readdirSync(destino)
    .filter(f => f.endsWith('.gymbak'))
    .map(f => {
      const ruta = path.join(destino, f);
      const stat = fs.statSync(ruta);
      return { nombre: f, ruta, fecha: stat.mtime.toISOString(), tamanoBytes: stat.size };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

function restaurarRespaldo(rutaArchivo) {
  const dek = obtenerDekEnMemoria();
  if (!dek) {
    throw new Error('No se puede restaurar: la app no está desbloqueada');
  }

  const contenido = fs.readFileSync(rutaArchivo);

  let zipBuffer;
  if (pareceFormatoNuevo(contenido)) {
    zipBuffer = descifrarBuffer(contenido.subarray(MARCA.length), dek);
  } else {
    // Formato de la primera version: hexadecimal en texto, sin marca.
    zipBuffer = descifrarBuffer(Buffer.from(contenido.toString('utf-8'), 'hex'), dek);
  }

  const zip = new AdmZip(zipBuffer);
  const entrada = zip.getEntry('gym.db');
  if (!entrada) {
    throw new Error('El archivo de respaldo no contiene una base de datos válida');
  }
  const dbBuffer = entrada.getData();

  const userDataPath = app.getPath('userData');
  const rutaPendiente = path.join(userDataPath, 'gym.db.restored');
  fs.writeFileSync(rutaPendiente, dbBuffer);

  const rutaFlag = path.join(userDataPath, 'restore-pendiente.flag');
  fs.writeFileSync(rutaFlag, rutaPendiente);

  return { ok: true, requiereReiniciar: true };
}

module.exports = { generarRespaldo, listarRespaldos, carpetaRespaldosDefault, restaurarRespaldo };
