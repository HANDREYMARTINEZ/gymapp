const { getDb } = require('../connection');

function crear(plan) {
  const info = getDb().prepare(`
    INSERT INTO planes (nombre, tipo, precio, dias_duracion, num_tickets, dias_vigencia, color, activo)
    VALUES (@nombre, @tipo, @precio, @dias_duracion, @num_tickets, @dias_vigencia, @color, 1)
  `).run({
    nombre: plan.nombre,
    tipo: plan.tipo,
    precio: plan.precio,
    dias_duracion: plan.tipo === 'periodo' ? plan.dias_duracion : null,
    num_tickets: plan.tipo === 'ticketera' ? plan.num_tickets : null,
    dias_vigencia: plan.tipo === 'ticketera' ? (plan.dias_vigencia || null) : null,
    color: plan.color || null,
  });
  return info.lastInsertRowid;
}

function listar() {
  return getDb().prepare(`SELECT * FROM planes WHERE activo = 1 ORDER BY nombre`).all();
}

function obtenerPorId(id) {
  return getDb().prepare(`SELECT * FROM planes WHERE id = ?`).get(id);
}

function editar(id, cambios) {
  getDb().prepare(`
    UPDATE planes SET
      nombre = @nombre, precio = @precio,
      dias_duracion = @dias_duracion, num_tickets = @num_tickets,
      dias_vigencia = @dias_vigencia, color = @color
    WHERE id = @id
  `).run({ ...cambios, id });
  return true;
}

function desactivar(id) {
  getDb().prepare(`UPDATE planes SET activo = 0 WHERE id = ?`).run(id);
  return true;
}

module.exports = { crear, listar, obtenerPorId, editar, desactivar };