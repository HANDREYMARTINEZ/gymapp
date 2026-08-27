const { getDb } = require('../db/connection');
const argon2 = require('argon2');

async function identificarPorDocumentoYPin(ult4, pinIngresado) {
  const candidatos = getDb().prepare(`
    SELECT id, nombre, pin FROM clientes WHERE documento_ult4 = ? AND activo = 1
  `).all(ult4);

  if (candidatos.length === 0) {
    return { ok: false, motivo: 'no_registrado' };
  }

  for (const candidato of candidatos) {
    if (!candidato.pin) continue; // cliente sin PIN asignado aún
    const coincide = await argon2.verify(candidato.pin, pinIngresado);
    if (coincide) {
      return { ok: true, clienteId: candidato.id, nombre: candidato.nombre };
    }
  }

  // Ningún candidato coincidió — registrar auditoría silenciosa, sin bloqueo
  getDb().prepare(`
    INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
    VALUES (NULL, 'pin_fallido', 'clientes', NULL, ?, ?)
  `).run(new Date().toISOString(), JSON.stringify({ ult4, candidatos: candidatos.length }));

  return { ok: false, motivo: 'pin_incorrecto' };
}

module.exports = { identificarPorDocumentoYPin };