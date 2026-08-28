const argon2 = require('argon2');
const { getDb } = require('../connection');

const ROLES = ['admin', 'asistente'];

// Los usuarios nunca se borran: membresias, pagos, ventas, asistencias y
// auditoria apuntan a usuarios.id, y borrar uno dejaria huerfano medio historial
// o, peor, lo reasignaria al siguiente id. Se desactivan, que es lo que el login
// ya mira.

function normalizarUsuario(usuario) {
  return String(usuario || '').trim().toLowerCase();
}

function sinHash(fila) {
  if (!fila) return fila;
  const { hash_pass, ...resto } = fila;
  return resto;
}

function listar() {
  return getDb().prepare(`
    SELECT id, nombre, usuario, rol, activo, creado_en
    FROM usuarios ORDER BY activo DESC, nombre
  `).all();
}

function obtenerPorId(id) {
  return sinHash(getDb().prepare(`SELECT * FROM usuarios WHERE id = ?`).get(id));
}

function contarAdminsActivos(exceptoId) {
  const row = exceptoId
    ? getDb().prepare(`SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id != ?`).get(exceptoId)
    : getDb().prepare(`SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1`).get();
  return row.n;
}

// Sin esto la app se puede dejar sin ningun admin -- desactivando al ultimo o
// bajandolo a asistente -- y ya nadie podria entrar a arreglarlo, porque la
// pantalla de Usuarios es solo para admins. No hay puerta de atras, asi que el
// candado va aqui.
function quedariaSinAdmin(id, { nuevoRol, nuevoActivo }) {
  const actual = getDb().prepare(`SELECT rol, activo FROM usuarios WHERE id = ?`).get(id);
  if (!actual || actual.rol !== 'admin' || !actual.activo) return false;

  const sigueSiendoAdminActivo =
    (nuevoRol === undefined ? 'admin' : nuevoRol) === 'admin' &&
    (nuevoActivo === undefined ? 1 : nuevoActivo) === 1;
  if (sigueSiendoAdminActivo) return false;

  return contarAdminsActivos(id) === 0;
}

async function crear({ nombre, usuario, password, rol }) {
  if (!nombre || !String(nombre).trim()) return { ok: false, motivo: 'nombre_requerido' };
  if (!ROLES.includes(rol)) return { ok: false, motivo: 'rol_invalido' };

  const login = normalizarUsuario(usuario);
  if (login.length < 3) return { ok: false, motivo: 'usuario_muy_corto' };
  if (!password || String(password).length < 4) return { ok: false, motivo: 'password_muy_corta' };

  // No basta con el UNIQUE de la tabla: es sensible a mayusculas, asi que una
  // cuenta vieja 'Ana' no chocaria con una nueva 'ana' y quedarian dos logins
  // que el auth, ya insensible a mayusculas, no podria distinguir.
  const yaExiste = getDb().prepare(`SELECT 1 FROM usuarios WHERE lower(usuario) = ?`).get(login);
  if (yaExiste) return { ok: false, motivo: 'usuario_ya_existe' };

  const hash = await argon2.hash(password);

  try {
    const info = getDb().prepare(`
      INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(String(nombre).trim(), login, hash, rol, new Date().toISOString());
    return { ok: true, id: info.lastInsertRowid };
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return { ok: false, motivo: 'usuario_ya_existe' };
    throw e;
  }
}

function editar(id, { nombre, rol }) {
  const actual = getDb().prepare(`SELECT * FROM usuarios WHERE id = ?`).get(id);
  if (!actual) return { ok: false, motivo: 'no_existe' };
  if (!nombre || !String(nombre).trim()) return { ok: false, motivo: 'nombre_requerido' };
  if (!ROLES.includes(rol)) return { ok: false, motivo: 'rol_invalido' };

  if (quedariaSinAdmin(id, { nuevoRol: rol })) {
    return { ok: false, motivo: 'ultimo_admin' };
  }

  getDb().prepare(`UPDATE usuarios SET nombre = ?, rol = ? WHERE id = ?`)
    .run(String(nombre).trim(), rol, id);
  return { ok: true };
}

// El usuario (login) no se cambia. Es lo que ata la persona a su historial en la
// cabeza de quien lo lee; renombrarlo no rompe ninguna FK, pero convierte los
// registros viejos en algo que ya nadie reconoce.

async function cambiarPassword({ id, password }) {
  if (!password || String(password).length < 4) return { ok: false, motivo: 'password_muy_corta' };
  const existe = getDb().prepare(`SELECT 1 FROM usuarios WHERE id = ?`).get(id);
  if (!existe) return { ok: false, motivo: 'no_existe' };

  const hash = await argon2.hash(password);
  getDb().prepare(`UPDATE usuarios SET hash_pass = ? WHERE id = ?`).run(hash, id);
  return { ok: true };
}

function desactivar(id) {
  const actual = getDb().prepare(`SELECT * FROM usuarios WHERE id = ?`).get(id);
  if (!actual) return { ok: false, motivo: 'no_existe' };
  if (!actual.activo) return { ok: false, motivo: 'ya_inactivo' };

  if (quedariaSinAdmin(id, { nuevoActivo: 0 })) {
    return { ok: false, motivo: 'ultimo_admin' };
  }

  getDb().prepare(`UPDATE usuarios SET activo = 0 WHERE id = ?`).run(id);
  return { ok: true };
}

function activar(id) {
  const existe = getDb().prepare(`SELECT 1 FROM usuarios WHERE id = ?`).get(id);
  if (!existe) return { ok: false, motivo: 'no_existe' };
  getDb().prepare(`UPDATE usuarios SET activo = 1 WHERE id = ?`).run(id);
  return { ok: true };
}

module.exports = {
  ROLES, listar, obtenerPorId, crear, editar, cambiarPassword,
  desactivar, activar, contarAdminsActivos,
};
