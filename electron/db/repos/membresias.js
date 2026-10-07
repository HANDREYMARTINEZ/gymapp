const { getDb } = require('../connection');
const { format, addDays, parseISO, differenceInCalendarDays } = require('date-fns');
const { calcularFechaInicioRenovacion, estadoMembresia } = require('../../services/membresias-logica');
const { hayPausaActiva } = require('./pausas');
const caja = require('./caja');
const { esEfectivo, esMedioValido } = require('../../services/medios-pago');


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

// La fecha de inicio se elige a mano desde el diseno v2, asi que hay que
// distinguir tres casos: no la mandaron (se calcula como siempre), la mandaron
// bien, o la mandaron rota. Devolver undefined para lo roto en vez de null
// permite separar "no vino" de "vino mal".
function normalizarFechaInicio(f) {
  if (f == null || f === '') return null;
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return undefined;
  const d = parseISO(f);
  if (Number.isNaN(d.getTime()) || format(d, 'yyyy-MM-dd') !== f) return undefined;
  return f;
}

function vender({ clienteId, planId, usuarioId, descuentoPct = 0, fInicio: fInicioPedida = null }) {
  const plan = getDb().prepare(`SELECT * FROM planes WHERE id = ? AND activo = 1`).get(planId);
  if (!plan) throw new Error('plan_inactivo');

  // El <input type=number min=0 max=100> no frena al teclear: escribir 150 daba
  // una membresia con precio NEGATIVO, y ese numero se arrastra a la ficha, a
  // los informes y al saldo.
  const pct = Number(descuentoPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('descuento_invalido');
  descuentoPct = pct;

  const hoy = hoyISO();
  const pedida = normalizarFechaInicio(fInicioPedida);
  if (pedida === undefined) throw new Error('Fecha de inicio invalida');

  // Sin fecha explicita se conserva el comportamiento de siempre: la membresia
  // nueva empieza cuando termina la anterior del mismo tipo, no hoy.
  const fInicio = pedida !== null
    ? pedida
    : calcularFechaInicioRenovacion(obtenerUltimaDelMismoTipo(clienteId, plan.tipo), hoy);

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

// Anadir o quitar tiquetes de una ticketera ya vendida.
//
// La verdad de cuantos tiquetes hay sigue siendo `tickets_totales`, y lo gastado
// sigue contandose en `asistencias` (una fila por entrada). No se abre una
// segunda contabilidad de movimientos: dos cuentas de lo mismo acaban
// discrepando, y la de las asistencias es la que no se puede falsear. Lo que si
// queda escrito es el ajuste -- quien, cuando, cuantos y por que -- en
// `auditoria`, donde ya viven las anulaciones y las bajas.
//
// El freno: no se puede dejar al cliente con tiquetes disponibles en negativo.
// Quitar mas de los que quedan es siempre un error de dedo.
function ajustarTickets({ membresiaId, delta, motivo, usuarioId } = {}) {
  const db = getDb();
  const n = parseInt(delta, 10);
  if (!Number.isInteger(n) || n === 0) return { ok: false, motivo: 'cantidad_invalida' };

  const m = db.prepare(`SELECT * FROM membresias WHERE id = ?`).get(membresiaId);
  if (!m) return { ok: false, motivo: 'no_existe' };
  if (m.anulada === 1) return { ok: false, motivo: 'esta_anulada' };
  if (m.plan_tipo !== 'ticketera') return { ok: false, motivo: 'no_es_ticketera' };

  const totales = (m.tickets_totales || 0) + n;
  const disponibles = totales - (m.tickets_usados || 0);
  if (disponibles < 0) {
    return { ok: false, motivo: 'quedaria_en_negativo',
             disponiblesAhora: (m.tickets_totales || 0) - (m.tickets_usados || 0) };
  }

  db.transaction(() => {
    db.prepare(`UPDATE membresias SET tickets_totales = ? WHERE id = ?`).run(totales, membresiaId);
    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'membresia_tickets', 'membresias', ?, ?, ?)
    `).run(usuarioId || null, membresiaId, new Date().toISOString(),
           JSON.stringify({ delta: n, motivo: motivo || null,
                            totalesAntes: m.tickets_totales, totalesDespues: totales }));
  })();

  return { ok: true, totales, usados: m.tickets_usados || 0, disponibles };
}

// Lo que la ficha necesita mostrar de una ticketera, y el historial de ajustes
// que le han hecho. Sin esto, "quitar tiquetes" seria una operacion a ciegas.
function estadoTickets(membresiaId) {
  const db = getDb();
  const m = db.prepare(`SELECT * FROM membresias WHERE id = ?`).get(membresiaId);
  if (!m || m.plan_tipo !== 'ticketera') return null;
  const ajustes = db.prepare(`
    SELECT fecha, detalle FROM auditoria
    WHERE accion = 'membresia_tickets' AND entidad_id = ?
    ORDER BY id DESC LIMIT 20
  `).all(membresiaId).map(a => {
    let d = {};
    try { d = JSON.parse(a.detalle || '{}'); } catch (e) {}
    return { fecha: a.fecha, delta: d.delta, motivo: d.motivo || null };
  });
  return {
    totales: m.tickets_totales || 0,
    usados: m.tickets_usados || 0,
    disponibles: (m.tickets_totales || 0) - (m.tickets_usados || 0),
    ajustes,
  };
}

// Todo pago entra a la caja con su medio. El de efectivo, ademas, cuenta en el
// arqueo: es dinero que entra al mismo cajon que las ventas. Los demas (QR,
// Llave, Nequi, tarjeta...) quedan en la caja para el cuadro por medio de pago;
// antes no se anotaban y en el gimnasio parecia que "no entraban a la caja".
// Por lo mismo se exige la caja abierta para cualquier medio: sin sesion el pago
// no tiene donde quedar registrado.
function registrarPago({ membresiaId, monto, metodo, usuarioId, nota }) {
  // Entero y positivo. Un decimal entraba tal cual en una columna INTEGER y
  // dejaba el arqueo con centavos que nadie puede contar en el cajon.
  const n = typeof monto === 'number' ? monto : parseInt(monto, 10);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, motivo: 'monto_invalido' };
  }
  monto = n;

  const m = getDb().prepare(`SELECT id, anulada FROM membresias WHERE id = ?`).get(membresiaId);
  if (!m) return { ok: false, motivo: 'no_existe' };
  // Anular una membresia anula sus pagos; uno registrado DESPUES se quedaba
  // vivo, entraba al cajon y sumaba a los ingresos del dia.
  if (m.anulada) return { ok: false, motivo: 'esta_anulada' };

  // El mismo freno que ya tenian los abonos de una venta fiada
  // ('mas_que_el_saldo') y el cobro de la cuenta de un cliente
  // ('mas_que_la_deuda'). Sin el, un cero de mas al teclear dejaba el saldo en
  // negativo y el arqueo del dia esperando un dinero que no entro.
  const saldo = calcularSaldoPendiente(membresiaId);
  if (monto > saldo) {
    return { ok: false, motivo: 'mas_que_el_saldo', saldo };
  }
  // Antes aceptaba cualquier texto. Con los fiados eso ya no vale: un "pago" con
  // metodo 'Fiado' bajaria el saldo sin que entrara dinero. Fiar una membresia es
  // fiar(), que no toca los pagos.
  if (!esMedioValido(metodo)) {
    return { ok: false, motivo: 'medio_pago_invalido' };
  }

  if (!caja.sesionAbierta()) {
    return { ok: false, motivo: 'sin_caja_abierta' };
  }

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO pagos (membresia_id, monto, metodo, fecha, usuario_id, nota, anulada)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(membresiaId, monto, metodo, new Date().toISOString(), usuarioId, nota || null);

    const mov = caja.registrarMovimiento({
      tipo: 'ingreso',
      concepto: 'Pago de membresía #' + membresiaId,
      monto,
      usuarioId,
      origen: 'membresia',
      metodo,
    });
    // Se lanza para que la transaccion tumbe tambien el pago: un pago sin su
    // movimiento de caja es exactamente el descuadre que esto evita.
    if (!mov.ok) throw new Error('caja_rechazo:' + mov.motivo);
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

// Fiar lo que falta de una membresia hasta una fecha. No mueve dinero ni crea
// pagos: el saldo sigue siendo precio_pagado menos lo abonado, y se cobra despues
// con registrarPago() como cualquier abono. Lo que cambia es el estado: hasta
// fiadoHasta (incluido) el saldo no bloquea la entrada; desde el dia siguiente, si
// sigue debiendo, vuelve a 'saldo_pendiente'. Decision de Andrey del 15-sep-2026.
//
// Se puede volver a llamar para mover la fecha ("paga el viernes" pasa a "paga el
// lunes"): cada cambio queda en auditoria con la fecha anterior.
function fiar({ membresiaId, fiadoHasta, usuarioId } = {}) {
  const db = getDb();
  const m = db.prepare(`SELECT * FROM membresias WHERE id = ?`).get(membresiaId);
  if (!m) return { ok: false, motivo: 'no_existe' };
  if (m.anulada) return { ok: false, motivo: 'esta_anulada' };

  const saldo = calcularSaldoPendiente(membresiaId);
  if (saldo <= 0) return { ok: false, motivo: 'sin_saldo' };

  const fecha = normalizarFechaInicio(fiadoHasta);
  if (!fecha) return { ok: false, motivo: 'fecha_invalida' };
  // Fiar hasta ayer seria dejarla bloqueada con apariencia de fiada.
  if (fecha < hoyISO()) return { ok: false, motivo: 'fecha_pasada' };

  db.transaction(() => {
    db.prepare(`UPDATE membresias SET fiado_hasta = ? WHERE id = ?`).run(fecha, membresiaId);
    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'membresia_fiada', 'membresias', ?, ?, ?)
    `).run(usuarioId || null, membresiaId, new Date().toISOString(),
           JSON.stringify({ saldo, fiadoHasta: fecha, antes: m.fiado_hasta || null }));
  })();

  return { ok: true, saldo, fiadoHasta: fecha };
}

// "Eliminar membresia" en la interfaz es esto: anular. La fila se queda, el
// estado cambia y se anulan tambien sus pagos. Borrarla de verdad romperia las
// asistencias y los pagos que apuntan a ella, y dejaria sin rastro una operacion
// que movio dinero.
//
// devolverEfectivo decide que pasa con lo ya cobrado en efectivo: o sale de la
// caja como egreso (se le devuelve al cliente) o se queda dentro. Lo elige quien
// anula, caso por caso, porque las dos cosas pasan en un mostrador.
function anular({ membresiaId, usuarioId, motivo = null, devolverEfectivo = false }) {
  const db = getDb();
  const m = db.prepare(`SELECT * FROM membresias WHERE id = ?`).get(membresiaId);
  if (!m) return { ok: false, motivo: 'no_existe' };
  if (m.anulada) return { ok: false, motivo: 'ya_anulada' };

  const pagos = db.prepare(`SELECT * FROM pagos WHERE membresia_id = ? AND anulada = 0`).all(membresiaId);
  const enEfectivo = pagos.filter(p => esEfectivo(p.metodo)).reduce((suma, p) => suma + p.monto, 0);

  // Mismo criterio que anular una venta del POS: si hay que sacar efectivo del
  // cajon, tiene que haber un cajon abierto donde anotarlo.
  if (devolverEfectivo && enEfectivo > 0 && !caja.sesionAbierta()) {
    return { ok: false, motivo: 'sin_caja_abierta' };
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE membresias SET anulada = 1, anulada_motivo = ? WHERE id = ?`)
      .run(motivo, membresiaId);
    db.prepare(`UPDATE pagos SET anulada = 1 WHERE membresia_id = ? AND anulada = 0`)
      .run(membresiaId);

    if (devolverEfectivo && enEfectivo > 0) {
      const mov = caja.registrarMovimiento({
        tipo: 'egreso',
        concepto: 'Devolución de membresía #' + membresiaId,
        monto: enEfectivo,
        usuarioId,
        origen: 'membresia',
      });
      if (!mov.ok) throw new Error('caja_rechazo:' + mov.motivo);
    }

    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'membresia_anulada', 'membresias', ?, ?, ?)
    `).run(usuarioId || null, membresiaId, new Date().toISOString(),
           JSON.stringify({ motivo, pagosAnulados: pagos.length, efectivoDevuelto: devolverEfectivo ? enEfectivo : 0 }));
  });

  try {
    tx();
  } catch (e) {
    const r = String(e.message).match(/^caja_rechazo:(.+)$/);
    if (r) return { ok: false, motivo: r[1] };
    throw e;
  }

  return { ok: true, pagosAnulados: pagos.length, efectivoDevuelto: devolverEfectivo ? enEfectivo : 0 };
}

// Corregir desde que dia cuenta una membresia ya vendida.
//
// El fin se mueve exactamente los mismos dias que el inicio, en vez de
// recalcularlo como f_inicio + dias del plan. Parece lo mismo y no lo es: pausar
// alarga f_fin, asi que en una membresia que estuvo pausada el fin NO es el
// inicio mas la duracion del plan. Recalcular desde cero le comeria al cliente
// los dias que se le habian devuelto por la pausa. Desplazar conserva la
// duracion real sea cual sea, y no necesita ni mirar el plan.
function cambiarFechaInicio({ membresiaId, fInicio, usuarioId }) {
  const db = getDb();
  const m = db.prepare(`SELECT * FROM membresias WHERE id = ?`).get(membresiaId);
  if (!m) return { ok: false, motivo: 'no_existe' };
  if (m.anulada) return { ok: false, motivo: 'esta_anulada' };

  const nueva = normalizarFechaInicio(fInicio);
  if (nueva === undefined || nueva === null) return { ok: false, motivo: 'fecha_invalida' };
  if (nueva === m.f_inicio) return { ok: true, sinCambios: true, fInicio: nueva, fFin: m.f_fin };

  const desplazamiento = differenceInCalendarDays(parseISO(nueva), parseISO(m.f_inicio));
  // Una ticketera sin vigencia no tiene fin que mover.
  const fFin = m.f_fin ? format(addDays(parseISO(m.f_fin), desplazamiento), 'yyyy-MM-dd') : null;

  db.transaction(() => {
    db.prepare(`UPDATE membresias SET f_inicio = ?, f_fin = ? WHERE id = ?`).run(nueva, fFin, membresiaId);
    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'membresia_fecha_inicio', 'membresias', ?, ?, ?)
    `).run(usuarioId || null, membresiaId, new Date().toISOString(),
           JSON.stringify({ antes: { fInicio: m.f_inicio, fFin: m.f_fin }, despues: { fInicio: nueva, fFin } }));
  })();

  return { ok: true, fInicio: nueva, fFin, desplazamiento };
}

// Renovar es vender otra vez el mismo plan. No hay logica propia: si la hubiera,
// una renovacion y una venta podrian empezar a comportarse distinto.
function renovar({ membresiaId, usuarioId, descuentoPct = 0, fInicio = null }) {
  const db = getDb();
  const m = db.prepare(`SELECT * FROM membresias WHERE id = ?`).get(membresiaId);
  if (!m) return { ok: false, motivo: 'no_existe' };

  const plan = db.prepare(`SELECT * FROM planes WHERE id = ?`).get(m.plan_id);
  if (!plan) return { ok: false, motivo: 'plan_no_existe' };
  // Un plan retirado del catalogo no se puede volver a vender ni renovando.
  if (!plan.activo) return { ok: false, motivo: 'plan_inactivo' };

  try {
    return { ok: true, membresiaId: vender({ clienteId: m.cliente_id, planId: m.plan_id, usuarioId, descuentoPct, fInicio }) };
  } catch (e) {
    // El motivo de verdad, no 'fecha_invalida' para todo: un descuento imposible
    // y una fecha rota se arreglan de formas distintas.
    return { ok: false, motivo: motivoDeVenta(e) };
  }
}

// Traduce lo que lanza vender() al vocabulario de motivos que entienden las
// pantallas. Vive aqui para que el canal IPC y renovar() contesten igual.
function motivoDeVenta(e) {
  const texto = String(e && e.message ? e.message : e);
  if (texto === 'descuento_invalido') return 'descuento_invalido';
  if (texto === 'plan_inactivo') return 'plan_inactivo';
  return 'fecha_invalida';
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

// Lo cobrado en efectivo y no anulado. Lo calcula el backend y no la pantalla
// porque solo aqui se sabe que metodos cuentan como efectivo (esEfectivo), y
// tenerlo en dos sitios es tenerlo mal en uno de los dos tarde o temprano.
function pagadoEnEfectivo(membresiaId) {
  return getDb()
    .prepare(`SELECT monto, metodo FROM pagos WHERE membresia_id = ? AND anulada = 0`)
    .all(membresiaId)
    .filter(p => esEfectivo(p.metodo))
    .reduce((suma, p) => suma + p.monto, 0);
}

function listarPorCliente(clienteId) {
  const membresias = getDb().prepare(`
    SELECT * FROM membresias WHERE cliente_id = ? ORDER BY creada_en DESC
  `).all(clienteId);

  return membresias.map(m => {
  const saldoPendiente = calcularSaldoPendiente(m.id);
  const pausaActiva = hayPausaActiva(m.id);
  return {
    ...m,
    saldoPendiente,
    pagadoEfectivo: pagadoEnEfectivo(m.id),
    estado: estadoMembresia(m, hoyISO(), pausaActiva, saldoPendiente),
  };
});
 
}

// Los pagos de membresia de un dia, con a quien pertenecen. Es la otra mitad de
// lo que entra al mostrador; las ventas de producto ya las lista ventas.js.
function pagosDelDia(fechaLocal) {
  const filas = getDb().prepare(`
    SELECT p.*, m.plan_nombre, c.id AS cliente_id, c.nombre AS cliente_nombre,
           u.nombre AS usuario_nombre
    FROM pagos p
    JOIN membresias m ON m.id = p.membresia_id
    JOIN clientes c ON c.id = m.cliente_id
    LEFT JOIN usuarios u ON u.id = p.usuario_id
    WHERE date(p.fecha, 'localtime') = ? AND p.anulada = 0
    ORDER BY p.fecha DESC, p.id DESC
  `).all(fechaLocal);

  return { fecha: fechaLocal, pagos: filas, total: filas.reduce((s, p) => s + p.monto, 0) };
}

function listarPagos(membresiaId) {
  return getDb().prepare(`SELECT * FROM pagos WHERE membresia_id = ? ORDER BY fecha DESC`).all(membresiaId);
}

module.exports = {
  ajustarTickets, estadoTickets, vender, anular, renovar, cambiarFechaInicio, registrarPago, fiar, pagosDelDia, calcularSaldoPendiente, listarPorCliente, listarPagos, motivoDeVenta };