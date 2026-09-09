const { getDb } = require('../connection');
const { format } = require('date-fns');
const { elegirTicketeraParaConsumo, elegirMembresiaGobernante, puedeEntrenar } = require('../../services/membresias-logica');
const { listarPorCliente } = require('./membresias');

function hoyISO() {
  return format(new Date(), 'yyyy-MM-dd');
}

function registrar({ clienteId, metodo, registradoPor }) {
  const membresias = listarPorCliente(clienteId);
  const gobernante = elegirMembresiaGobernante(membresias);

  if (!gobernante) {
    return { ok: false, motivo: 'sin_membresia' };
  }
  if (!puedeEntrenar(gobernante.estado)) {
    return { ok: false, motivo: gobernante.estado };
  }

  let ticketUsado = 0;
  let membresiaIdUsada = gobernante.id;

  if (gobernante.plan_tipo === 'ticketera') {
    const ticketeras = membresias.filter(m =>
      m.plan_tipo === 'ticketera' && puedeEntrenar(m.estado)
    );
    const elegida = elegirTicketeraParaConsumo(ticketeras);
    if (!elegida) {
      return { ok: false, motivo: 'agotada' };
    }
    getDb().prepare(`UPDATE membresias SET tickets_usados = tickets_usados + 1 WHERE id = ?`).run(elegida.id);
    ticketUsado = 1;
    membresiaIdUsada = elegida.id;
  }

  const hoy = hoyISO();
  try {
    getDb().prepare(`
      INSERT INTO asistencias (cliente_id, fecha_hora, fecha, metodo, membresia_id, ticket_usado, registrado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(clienteId, new Date().toISOString(), hoy, metodo, membresiaIdUsada, ticketUsado, registradoPor || null);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return { ok: false, motivo: 'ya_registrado_hoy' };
    }
    throw e;
  }

  return { ok: true, membresiaId: membresiaIdUsada, ticketUsado: !!ticketUsado, estado: gobernante.estado };
}

function listarDelDia(fecha) {
  return getDb().prepare(`
    SELECT a.*, c.nombre AS cliente_nombre
    FROM asistencias a JOIN clientes c ON c.id = a.cliente_id
    WHERE a.fecha = ?
    ORDER BY a.fecha_hora DESC
  `).all(fecha);
}

module.exports = { registrar, listarDelDia };