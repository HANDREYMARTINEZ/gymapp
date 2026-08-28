const { getDb } = require('../connection');
const { format, addDays, parseISO } = require('date-fns');
const { calcularFechaInicioRenovacion, estadoMembresia } = require('../../services/membresias-logica');
const { hayPausaActiva } = require('./pausas');
const caja = require('./caja');
const { esEfectivo } = require('../../services/medios-pago');


function hoyISO() {
  return format(new Date(), 'yyyy-MM-dd');
}

function obtenerUltimaDelMismoTipo(clienteId, tipo) {
  return getDb().prepare(`
    SELECT * FROM membresias
    WHERE cliente_id = ? AND plan_tipo = ? AND anulada = 0
    ORDER BY (f_fin IS NULL) ASC, f_fin DESC
    LIMIT 1
  `).get(clienteId, tipo);
}

function vender({ clienteId, planId, usuarioId, descuentoPct = 0 }) {
  const plan = getDb().prepare(`SELECT * FROM planes WHERE id = ? AND activo = 1`).get(planId);
  if (!plan) throw new Error('Plan no encontrado o inactivo');

  const hoy = hoyISO();
  const anterior = obtenerUltimaDelMismoTipo(clienteId, plan.tipo);
  const fInicio = calcularFechaInicioRenovacion(anterior, hoy);

  let fFin = null;
  let ticketsTotales = null;

  if (plan.tipo === 'periodo') {
    fFin = format(addDays(parseISO(fInicio), plan.dias_duracion - 1), 'yyyy-MM-dd');
  } else {
    ticketsTotales = plan.num_tickets;
    if (plan.dias_vigencia) {
      fFin = format(addDays(parseISO(fInicio), plan.dias_vigencia - 1), 'yyyy-MM-dd');
    }
  }

  const precioPagado = Math.round(plan.precio * (1 - descuentoPct / 100));

  const info = getDb().prepare(`
    INSERT INTO membresias (cliente_id, plan_id, plan_nombre, plan_tipo, f_inicio, f_fin, tickets_totales, tickets_usados, precio_pagado, descuento, vendida_por, creada_en, anulada)
    VALUES (@clienteId, @planId, @planNombre, @planTipo, @fInicio, @fFin, @ticketsTotales, 0, @precioPagado, @descuentoPct, @usuarioId, @creadaEn, 0)
  `).run({
    clienteId, planId, planNombre: plan.nombre, planTipo: plan.tipo,
    fInicio, fFin, ticketsTotales, precioPagado, descuentoPct, usuarioId,
    creadaEn: new Date().toISOString(),
  });

  return info.lastInsertRowid;
}

// Un pago en efectivo es dinero que entra al mismo cajon que las ventas, asi que
// tiene que aparecer en el arqueo. Si no, todo dia con pagos en efectivo cierra
// con un sobrante falso y el arqueo deja de servir para detectar errores.
// Por lo mismo se exige la caja abierta: sin sesion el efectivo no tiene donde
// quedar registrado, y aceptarlo igual seria romper el arqueo en silencio.
function registrarPago({ membresiaId, monto, metodo, usuarioId, nota }) {
  if (!monto || monto <= 0) {
    return { ok: false, motivo: 'monto_invalido' };
  }

  const enEfectivo = esEfectivo(metodo);
  if (enEfectivo && !caja.sesionAbierta()) {
    return { ok: false, motivo: 'sin_caja_abierta' };
  }

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO pagos (membresia_id, monto, metodo, fecha, usuario_id, nota, anulada)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(membresiaId, monto, metodo, new Date().toISOString(), usuarioId, nota || null);

    if (enEfectivo) {
      const mov = caja.registrarMovimiento({
        tipo: 'ingreso',
        concepto: 'Pago de membresía #' + membresiaId,
        monto,
        usuarioId,
      });
      // Se lanza para que la transaccion tumbe tambien el pago: un pago sin su
      // movimiento de caja es exactamente el descuadre que esto evita.
      if (!mov.ok) throw new Error('caja_rechazo:' + mov.motivo);
    }
  });

  try {
    tx();
  } catch (e) {
    const m = String(e.message).match(/^caja_rechazo:(.+)$/);
    if (m) return { ok: false, motivo: m[1] };
    throw e;
  }

  return { ok: true };
}

function calcularSaldoPendiente(membresiaId) {
  const row = getDb().prepare(`
    SELECT m.precio_pagado - COALESCE(SUM(p.monto), 0) AS saldo
    FROM membresias m LEFT JOIN pagos p ON p.membresia_id = m.id AND p.anulada = 0
    WHERE m.id = ?
    GROUP BY m.id
  `).get(membresiaId);
  return row ? row.saldo : 0;
}

function listarPorCliente(clienteId) {
  const membresias = getDb().prepare(`
    SELECT * FROM membresias WHERE cliente_id = ? ORDER BY creada_en DESC
  `).all(clienteId);

  return membresias.map(m => {
  const saldoPendiente = calcularSaldoPendiente(m.id);
  const pausaActiva = hayPausaActiva(m.id);
  return { ...m, saldoPendiente, estado: estadoMembresia(m, hoyISO(), pausaActiva, saldoPendiente) };
});
 
}

function listarPagos(membresiaId) {
  return getDb().prepare(`SELECT * FROM pagos WHERE membresia_id = ? ORDER BY fecha DESC`).all(membresiaId);
}

module.exports = { vender, registrarPago, calcularSaldoPendiente, listarPorCliente, listarPagos };