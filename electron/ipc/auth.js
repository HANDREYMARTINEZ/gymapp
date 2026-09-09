const { ipcMain } = require('electron');
const crypto = require('crypto');
const argon2 = require('argon2');
const { getDb } = require('../db/connection');
const llaves = require('../services/llaves');
const sesionDev = require('../services/sesionDev');
const { guardarDekEnMemoria, obtenerDekEnMemoria } = require('../crypto/dek');

function buscarUsuario(usuario) {
  // Comparacion insensible a mayusculas: el repo de usuarios guarda el login en
  // minusculas, pero el wizard de setup no lo hacia, asi que puede haber cuentas
  // viejas con mayusculas. Con lower() a ambos lados entran las dos sin migrar
  // nada, y nadie queda fuera por como escribio su propio nombre de usuario.
  return getDb().prepare(
    `SELECT id, nombre, usuario, hash_pass, rol, activo FROM usuarios
     WHERE lower(usuario) = lower(?)`
  ).get(String(usuario || '').trim());
}

const publico = (row) => ({ id: row.id, nombre: row.nombre, usuario: row.usuario, rol: row.rol });

// Entrar al sistema es tambien abrir el cifrado: la contrasena del usuario
// desenvuelve la DEK. Por eso ya no hay pantalla de passphrase al arrancar.
//
// La primera vez que alguien entra despues de este cambio todavia no tiene su
// envoltura, porque solo existe la de la passphrase y de esa no se puede sacar
// nada sin escribirla. En ese caso el login sale con necesitaPassphrase y la
// pantalla la pide una unica vez para crearsela.
ipcMain.handle('auth:login', async (_evt, usuario, password) => {
  const row = buscarUsuario(usuario);
  if (!row || !row.activo) {
    return { ok: false, error: 'Usuario o contraseña incorrectos' };
  }
  if (!(await argon2.verify(row.hash_pass, password))) {
    return { ok: false, error: 'Usuario o contraseña incorrectos' };
  }

  // Entrar por la puerta normal cierra el panel de desarrollador. Si no, el
  // siguiente turno heredaria las herramientas de borrado de quien estuvo antes.
  sesionDev.desactivar();

  const dek = await llaves.abrirConPassword(row.id, password);
  if (dek) {
    guardarDekEnMemoria(dek);
    return { ok: true, usuario: publico(row) };
  }

  return { ok: true, usuario: publico(row), necesitaPassphrase: true };
});

// Paso unico de enganche: con la passphrase se abre la DEK y se le crea al
// usuario su propia envoltura. A partir de aqui ese usuario entra solo con su
// contrasena y no vuelve a ver esta pantalla.
ipcMain.handle('auth:vincularPassphrase', async (_evt, { usuario, password, passphrase }) => {
  const row = buscarUsuario(usuario);
  if (!row || !row.activo) return { ok: false, motivo: 'usuario_invalido' };
  if (!(await argon2.verify(row.hash_pass, password))) return { ok: false, motivo: 'usuario_invalido' };

  const dek = await llaves.abrirConPassphrase(passphrase);
  if (!dek) return { ok: false, motivo: 'passphrase_incorrecta' };

  await llaves.guardarLlave(row.id, password, dek);
  guardarDekEnMemoria(dek);
  return { ok: true, usuario: publico(row) };
});

// Acceso de desarrollador (Ctrl+Alt+D). Lo confirma la passphrase, que ya no se
// usa para nada del dia a dia y por eso sirve de llave aparte.
//
// Entra con su propia cuenta y no con la de nadie: las ventas, los pagos y la
// auditoria apuntan a un usuario real, y no quedan a nombre del administrador
// que estuviera de turno. La cuenta va inactiva a proposito, para que no se
// pueda entrar en ella por el login normal.
ipcMain.handle('auth:accesoDesarrollador', async (_evt, passphrase) => {
  const dek = await llaves.abrirConPassphrase(passphrase);
  if (!dek) return { ok: false, motivo: 'passphrase_incorrecta' };
  guardarDekEnMemoria(dek);

  const db = getDb();
  let row = db.prepare(`SELECT * FROM usuarios WHERE usuario = 'desarrollador'`).get();
  if (!row) {
    const hashInservible = await argon2.hash(crypto.randomBytes(32).toString('hex'));
    db.prepare(`
      INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
      VALUES ('Desarrollador', 'desarrollador', ?, 'admin', 0, ?)
    `).run(hashInservible, new Date().toISOString());
    row = db.prepare(`SELECT * FROM usuarios WHERE usuario = 'desarrollador'`).get();
  }

  db.prepare(`
    INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
    VALUES (?, 'acceso_desarrollador', 'usuarios', ?, ?, NULL)
  `).run(row.id, row.id, new Date().toISOString());

  sesionDev.activar();
  return { ok: true, usuario: { ...publico(row), desarrollador: true } };
});

// Cerrar sesion en la pantalla tiene que cerrar tambien la puerta del panel: el
// estado que manda vive en el proceso principal, no en el renderer.
ipcMain.handle('auth:cerrarSesion', () => {
  sesionDev.desactivar();
  return { ok: true };
});

ipcMain.handle('auth:estaAbierto', () => obtenerDekEnMemoria() !== null);

module.exports = {};
