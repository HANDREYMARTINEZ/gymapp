const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/connection');
const usuarios = require('../db/repos/usuarios');
const { generarDEK, generarSalt, derivarKEK, envolverDEK, envolverDEKConClavePublica } = require('../crypto/dek');

function getConfig(clave) {
  const row = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  return row ? row.valor : null;
}

function setConfig(clave, valor) {
  getDb().prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  ).run(clave, valor);
}

ipcMain.handle('setup:estado', () => {
  return {
    setupCompleto: getConfig('setup_completo') === '1',
    pasoActual: parseInt(getConfig('setup_paso_actual') || '1', 10),
    gymNombre: getConfig('gym_nombre') || '',
    gymDireccion: getConfig('gym_direccion') || '',
    gymTelefono: getConfig('gym_telefono') || '',
    gymNit: getConfig('gym_nit') || '',
  };
});

ipcMain.handle('setup:datos-gimnasio', (_evt, datos) => {
  setConfig('gym_nombre', datos.nombre);
  setConfig('gym_direccion', datos.direccion || '');
  setConfig('gym_telefono', datos.telefono || '');
  setConfig('gym_nit', datos.nit || '');
  setConfig('setup_paso_actual', '3');
  return true;
});

// Pasa por el repo de usuarios en vez de insertar a mano, para que el admin del
// wizard nazca con las mismas reglas que cualquier otro: login normalizado a
// minusculas y las mismas validaciones. Insertando aqui aparte, el primer usuario
// del sistema era justo el que no las cumplia.
ipcMain.handle('setup:crear-admin', async (_evt, datos) => {
  const r = await usuarios.crear({
    nombre: datos.nombre,
    usuario: datos.usuario,
    password: datos.password,
    rol: 'admin',
  });
  if (!r.ok) return r;
  setConfig('setup_paso_actual', '4');
  return r;
});

// Empaquetada, la app corre desde dentro del asar y __dirname apunta ahi, asi
// que la ruta relativa a resources/ del proyecto deja de existir. El .pem se
// copia como extraResource y en produccion vive junto a process.resourcesPath.
function rutaClavePublica() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'dev-public.pem')
    : path.join(__dirname, '../../resources/dev-public.pem');
}

ipcMain.handle('setup:finalizar', (_evt, passphrase) => {
  const db = getDb();
  const publicKeyPem = fs.readFileSync(rutaClavePublica(), 'utf-8');

  const tx = db.transaction(() => {
    const dek = generarDEK();
    const salt = generarSalt();
    const kek = derivarKEK(passphrase, salt);

    const dekWrappedUser = envolverDEK(dek, kek);
    const dekWrappedRecovery = envolverDEKConClavePublica(dek, publicKeyPem);

    setConfig('kdf_salt', salt);
    setConfig('dek_wrapped_user', dekWrappedUser);
    setConfig('dek_wrapped_recovery', dekWrappedRecovery);
    setConfig('setup_completo', '1');
  });

  tx();
  return true;
});

module.exports = {};