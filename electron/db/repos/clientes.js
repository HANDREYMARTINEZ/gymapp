const { getDb } = require('../connection');

function crear(cliente) {
  const documento = cliente.documento || null;
  const ult4 = documento ? documento.slice(-4) : null;
  const info = getDb().prepare(`
    INSERT INTO clientes (documento, documento_ult4, nombre, telefono, email, foto, f_nacimiento, f_registro, pin, contacto_emg, notas, activo)
    VALUES (@documento, @ult4, @nombre, @telefono, @email, @foto, @f_nacimiento, @f_registro, @pin, @contacto_emg, @notas, 1)
  `).run({
    documento,
    ult4,
    nombre: cliente.nombre,
    telefono: cliente.telefono || null,
    email: cliente.email || null,
    foto: cliente.foto || null,
    f_nacimiento: cliente.f_nacimiento || null,
    f_registro: new Date().toISOString(),
    pin: null, // el PIN se asigna después (F2)
    contacto_emg: cliente.contacto_emg || null,
    notas: cliente.notas || null,
  });
  return info.lastInsertRowid;
}

function buscar(texto) {
  const like = `%${texto}%`;
  return getDb().prepare(`
    SELECT id, documento, nombre, telefono, activo
    FROM clientes
    WHERE activo = 1 AND (nombre LIKE ? OR documento LIKE ?)
    ORDER BY nombre
    LIMIT 50
  `).all(like, like);
}

function obtenerPorId(id) {
  return getDb().prepare(`SELECT * FROM clientes WHERE id = ?`).get(id);
}

function editar(id, cambios) {
  const documento = cambios.documento || null;
  const ult4 = documento ? documento.slice(-4) : null;
  getDb().prepare(`
    UPDATE clientes SET
      documento = @documento, documento_ult4 = @ult4, nombre = @nombre,
      telefono = @telefono, email = @email, foto = @foto,
      f_nacimiento = @f_nacimiento, contacto_emg = @contacto_emg, notas = @notas
    WHERE id = @id
  `).run({ ...cambios, documento, ult4, id });
  return true;
}
async function asignarPin(id, pinTextoPlano) {
  const argon2 = require('argon2');
  const hash = await argon2.hash(pinTextoPlano);
  getDb().prepare(`UPDATE clientes SET pin = ? WHERE id = ?`).run(hash, id);
  return true;
}

module.exports = { crear, buscar, obtenerPorId, editar, asignarPin };
