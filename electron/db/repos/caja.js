const { getDb } = require('../connection');

// Los ORDER BY desempatan por id porque abierta_en/fecha son ISO con
// milisegundos y dos escrituras seguidas pueden compartir el mismo instante.
// Sin el desempate el orden lo decide SQLite y deja de ser reproducible.

// caja_movimientos registra EFECTIVO, no ingresos contables. Una venta con
// tarjeta no entra al cajon, asi que no genera movimiento: si entrara, el arqueo
// pediria contar un dinero que nunca estuvo ahi. El POS (3.5) solo enviara aqui
// lo que se cobre en efectivo.

function sesionAbierta() {
  return getDb().prepare(`
    SELECT s.*, u.nombre AS usuario_nombre
    FROM caja_sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.cerrada_en IS NULL
    ORDER BY s.abierta_en DESC, s.id DESC
    LIMIT 1
  `).get();
}

function abrir({ usuarioId, baseInicial }) {
  if (baseInicial == null || baseInicial < 0) {
    return { ok: false, motivo: 'base_invalida' };
  }
  // Una sola caja abierta a la vez: con dos, ningun arqueo cuadra porque el
  // cajon fisico es uno solo.
  if (sesionAbierta()) {
    return { ok: false, motivo: 'ya_hay_sesion_abierta' };
  }

  const info = getDb().prepare(`
    INSERT INTO caja_sesiones (usuario_id, abierta_en, base_inicial)
    VALUES (?, ?, ?)
  `).run(usuarioId, new Date().toISOString(), baseInicial);

  return { ok: true, id: info.lastInsertRowid };
}

function registrarMovimiento({ tipo, concepto, monto, usuarioId }) {
  if (tipo !== 'ingreso' && tipo !== 'egreso') {
    return { ok: false, motivo: 'tipo_invalido' };
  }
  if (!monto || monto <= 0) {
    return { ok: false, motivo: 'monto_invalido' };
  }
  if (!concepto || !String(concepto).trim()) {
    return { ok: false, motivo: 'concepto_requerido' };
  }

  const sesion = sesionAbierta();
  if (!sesion) {
    return { ok: false, motivo: 'sin_sesion_abierta' };
  }

  const info = getDb().prepare(`
    INSERT INTO caja_movimientos (sesion_id, tipo, concepto, monto, fecha, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sesion.id, tipo, String(concepto).trim(), monto, new Date().toISOString(), usuarioId);

  return { ok: true, id: info.lastInsertRowid, sesionId: sesion.id };
}

function listarMovimientos(sesionId) {
  return getDb().prepare(`
    SELECT m.*, u.nombre AS usuario_nombre
    FROM caja_movimientos m LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.sesion_id = ?
    ORDER BY m.fecha, m.id
  `).all(sesionId);
}

// Lo que deberia haber en el cajon si nadie se equivoco.
function resumen(sesionId) {
  const db = getDb();
  // Con el JOIN, no con un SELECT * : quien consuma el resumen espera el mismo
  // objeto de sesion que devuelve sesionAbierta(), nombre del usuario incluido.
  const sesion = db.prepare(`
    SELECT s.*, u.nombre AS usuario_nombre
    FROM caja_sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.id = ?
  `).get(sesionId);
  if (!sesion) return null;

  const totales = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto END), 0) AS ingresos,
      COALESCE(SUM(CASE WHEN tipo = 'egreso'  THEN monto END), 0) AS egresos
    FROM caja_movimientos WHERE sesion_id = ?
  `).get(sesionId);

  const esperado = sesion.base_inicial + totales.ingresos - totales.egresos;

  return {
    sesion,
    ingresos: totales.ingresos,
    egresos: totales.egresos,
    esperado,
    movimientos: listarMovimientos(sesionId),
  };
}

function cerrar({ efectivoContado, nota }) {
  if (efectivoContado == null || efectivoContado < 0) {
    return { ok: false, motivo: 'conteo_invalido' };
  }

  const sesion = sesionAbierta();
  if (!sesion) {
    return { ok: false, motivo: 'sin_sesion_abierta' };
  }

  const { esperado } = resumen(sesion.id);
  // Positiva = sobra dinero, negativa = falta. Se guarda aunque sea cero: que el
  // arqueo cuadre es un hecho que vale la pena poder consultar despues.
  const diferencia = efectivoContado - esperado;

  getDb().prepare(`
    UPDATE caja_sesiones
    SET cerrada_en = ?, efectivo_contado = ?, diferencia = ?, nota = ?
    WHERE id = ?
  `).run(new Date().toISOString(), efectivoContado, diferencia, nota || null, sesion.id);

  return { ok: true, sesionId: sesion.id, esperado, efectivoContado, diferencia };
}

function listarSesiones(limite = 30) {
  return getDb().prepare(`
    SELECT s.*, u.nombre AS usuario_nombre
    FROM caja_sesiones s JOIN usuarios u ON u.id = s.usuario_id
    ORDER BY s.abierta_en DESC, s.id DESC
    LIMIT ?
  `).all(limite);
}

module.exports = {
  sesionAbierta, abrir, registrarMovimiento, listarMovimientos,
  resumen, cerrar, listarSesiones,
};
