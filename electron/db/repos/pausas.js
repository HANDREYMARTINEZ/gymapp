const { getDb } = require('../connection');
const { format, addDays, differenceInCalendarDays, parseISO } = require('date-fns');

function hoyISO() {
  return format(new Date(), 'yyyy-MM-dd');
}

function pausar({ membresiaId, motivo, usuarioId }) {
  getDb().prepare(`
    INSERT INTO membresia_pausas (membresia_id, f_inicio, f_fin, motivo, usuario_id, creada_en)
    VALUES (?, ?, NULL, ?, ?, ?)
  `).run(membresiaId, hoyISO(), motivo || null, usuarioId, new Date().toISOString());
  return true;
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
    const pausa = db.prepare(`
      SELECT * FROM membresia_pausas WHERE membresia_id = ? AND f_fin IS NULL
    `).get(membresiaId);
    if (!pausa) throw new Error('No hay ninguna pausa activa para esta membresía');

    const hoy = hoyISO();
    const fFinPausa = format(addDays(parseISO(hoy), -1), 'yyyy-MM-dd');
    db.prepare(`UPDATE membresia_pausas SET f_fin = ? WHERE id = ?`).run(fFinPausa, pausa.id);

    const diasPausados = differenceInCalendarDays(parseISO(hoy), parseISO(pausa.f_inicio));
    if (diasPausados > 0) {
      const membresia = db.prepare(`SELECT f_fin FROM membresias WHERE id = ?`).get(membresiaId);
      if (membresia.f_fin) {
        const nuevaFecha = format(addDays(parseISO(membresia.f_fin), diasPausados), 'yyyy-MM-dd');
        db.prepare(`UPDATE membresias SET f_fin = ? WHERE id = ?`).run(nuevaFecha, membresiaId);
      }
    }
  });
  tx();
  return true;
}

function listarPorMembresia(membresiaId) {
  return getDb().prepare(`
    SELECT * FROM membresia_pausas WHERE membresia_id = ? ORDER BY f_inicio DESC
  `).all(membresiaId);
}

module.exports = { pausar, hayPausaActiva, reactivar, listarPorMembresia };