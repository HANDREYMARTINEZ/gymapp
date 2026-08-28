const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { app } = require('electron');
const { obtenerDekEnMemoria, cifrarBuffer } = require('../crypto/dek');

const MAX_RESPALDOS = 14; // ~2 semanas si se genera uno por día

function carpetaRespaldosDefault() {
  return path.join(app.getPath('userData'), 'respaldos');
}

function comprimirDb() {
  return new Promise((resolve, reject) => {
    const dbPath = path.join(app.getPath('userData'), 'gym.db');
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    archive.file(dbPath, { name: 'gym.db' });
    archive.finalize();
  });
}

async function generarRespaldo(carpetaDestino) {
  const dek = obtenerDekEnMemoria();
  if (!dek) {
    throw new Error('No se puede respaldar: la app no está desbloqueada (falta la passphrase de esta sesión)');
  }

  const destino = carpetaDestino || carpetaRespaldosDefault();
  fs.mkdirSync(destino, { recursive: true });

  const zipBuffer = await comprimirDb();
  const cifradoHex = cifrarBuffer(zipBuffer, dek);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nombreArchivo = `respaldo-${timestamp}.gymbak`;
  const rutaCompleta = path.join(destino, nombreArchivo);

  fs.writeFileSync(rutaCompleta, cifradoHex, 'utf-8');

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

module.exports = { generarRespaldo, listarRespaldos, carpetaRespaldosDefault };