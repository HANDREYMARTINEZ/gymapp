const { getDb } = require('../connection');
const { format, addDays, differenceInCalendarDays, parseISO } = require('date-fns');

function hoyISO() {
  return format(new Date(), 'yyyy-MM-dd');
}

// Pausar dos veces la misma membresia dejaba DOS filas con f_fin NULL, y
// reactivar cerraba solo una: la membresia seguia 'pausada' -- el kiosco no
// dejaba entrar al cliente -- y al volver a reactivar se le sumaban otra vez los
// dias de pausa a la fecha de fin. Basta un doble clic en "Confirmar pausa", que
// no bloquea el boton mientras guarda. Aqui se frena el segundo.
function pausar({ membresiaId, motivo, usuarioId }) {
  const db = getDb();
  const m = db.prepare(`SELECT id, anulada FROM membresias WHERE id = ?`).get(membresiaId);
  if (!m) return { ok: false, motivo: 'no_existe' };
  if (m.anulada) return { ok: false, motivo: 'esta_anulada' };
  if (pausaAbierta(membresiaId)) return { ok: false, motivo: 'ya_pausada' };

  const info = db.prepare(`
    INSERT INTO membresia_pausas (membresia_id, f_inicio, f_fin, motivo, usuario_id, creada_en)
    VALUES (?, ?, NULL, ?, ?, ?)
  `).run(membresiaId, hoyISO(), motivo || null, usuarioId, new Date().toISOString());
  return { ok: true, id: info.lastInsertRowid };
}

// La pausa sin cerrar mas antigua. Con los frenos de pausar() solo puede haber
// una, pero las bases que ya arrastren dos se arreglan solas al reactivar.
function pausaAbierta(membresiaId) {
  return getDb().prepare(`
    SELECT * FROM membresia_pausas
    WHERE membresia_id = ? AND f_fin IS NULL
    ORDER BY f_inicio, id
    LIMIT 1
  `).get(membresiaId);
}

function hayPausaActiva(membresiaId) {
  const hoy = hoyISO();
  const row = getDb().prepare(`
    SELECT id FROM membresia_pausas
    WHERE membresia_id = ? AND f_inicio <= ? AND (f_fin IS NULL OR f_fin >= ?)
  `).get(membresiaId, hoy, hoy);
  return !!row;
}

function reactivar(membresiaId) {
  const db = getDb();
  const tx = db.transaction(() => {
    const pausa = pausaAbierta(membresiaId);
    if (!pausa) return { ok: false, motivo: 'sin_pausa' };

    const hoy = hoyISO();
    const fFinPausa = format(addDays(parseISO(hoy), -1), 'yyyy-MM-dd');
    // TODAS las que quedaran abiertas, no solo la primera: si una base vieja
    // arrastra dos, cerrar una sola deja la membresia pausada para siempre.
    db.prepare(`UPDATE membresia_pausas SET f_fin = ? WHERE membresia_id = ? AND f_fin IS NULL`)
      .run(fFinPausa, membresiaId);

    // Los dias se cuentan UNA vez, desde la pausa mas antigua que seguia
    // abierta. Sumarlos por cada fila regalaria dias que nadie pauso.
    const diasPausados = differenceInCalendarDays(parseISO(hoy), parseISO(pausa.f_inicio));
    if (diasPausados > 0) {
      const membresia = db.prepare(`SELECT f_fin FROM membresias WHERE id = ?`).get(membresiaId);
      if (membresia && membresia.f_fin) {
        const nuevaFecha = format(addDays(parseISO(membresia.f_fin), diasPausados), 'yyyy-MM-dd');
        db.prepare(`UPDATE membresias SET f_fin = ? WHERE id = ?`).run(nuevaFecha, membresiaId);
      }
    }
    return { ok: true, diasPausados };
  });
  return tx();
}

function listarPorMembresia(membresiaId) {
  return getDb().prepare(`
    SELECT * FROM membresia_pausas WHERE membresia_id = ? ORDER BY f_inicio DESC
  `).all(membresiaId);
}

module.exports = { pausar, hayPausaActiva, reactivar, listarPorMembresia, pausaAbierta };
