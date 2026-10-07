const { getDb } = require('../connection');

// Los ORDER BY desempatan por id porque abierta_en/fecha son ISO con
// milisegundos y dos escrituras seguidas pueden compartir el mismo instante.
// Sin el desempate el orden lo decide SQLite y deja de ser reproducible.

// caja_movimientos registra todo lo cobrado mientras la caja esta abierta, con
// su medio de pago (migracion 013). Antes solo guardaba efectivo, y en el
// gimnasio lo cobrado por QR, Llave o Nequi "no entraba a la caja". El arqueo,
// en cambio, sigue contando solo el efectivo: lo demas no esta en el cajon, y
// pedir contarlo dejaria un faltante falso en cada cierre.
const { EFECTIVO, esEfectivo, esMedioValido } = require('../../services/medios-pago');

// Para las consultas: el mismo criterio de esEfectivo(), en SQL.
const SOLO_EFECTIVO = `LOWER(TRIM(metodo)) = LOWER('${EFECTIVO}')`;

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

const ORIGENES = ['venta', 'membresia', 'manual'];

function registrarMovimiento({ tipo, concepto, monto, usuarioId, origen = 'manual', metodo = EFECTIVO }) {
  if (tipo !== 'ingreso' && tipo !== 'egreso') {
    return { ok: false, motivo: 'tipo_invalido' };
  }
  if (!esMedioValido(metodo)) {
    return { ok: false, motivo: 'medio_pago_invalido' };
  }
  // Un gasto o una entrada escrita a mano es siempre del cajon: no hay forma de
  // sacar un domicilio "por Nequi" desde la caja.
  if (origen === 'manual' && !esEfectivo(metodo)) {
    return { ok: false, motivo: 'manual_solo_efectivo' };
  }
  // En el cajon hay billetes, no decimales: un monto con centavos dejaba el
  // arqueo pidiendo contar $66.000,75.
  if (!Number.isInteger(monto) || monto <= 0) {
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
    INSERT INTO caja_movimientos (sesion_id, tipo, concepto, monto, fecha, usuario_id, origen, metodo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sesion.id, tipo, String(concepto).trim(), monto, new Date().toISOString(), usuarioId,
         ORIGENES.includes(origen) ? origen : 'manual',
         esEfectivo(metodo) ? EFECTIVO : String(metodo).trim());

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
    FROM caja_movimientos WHERE sesion_id = ? AND ${SOLO_EFECTIVO}
  `).get(sesionId);

  const esperado = sesion.base_inicial + totales.ingresos - totales.egresos;

  // El mismo dinero, mirado por de donde viene. Lo pide 5.14 para poder ver de un
  // vistazo cuanto del cajon es del mostrador y cuanto de las membresias, sin
  // tener que sumar la lista de movimientos a ojo.
  const porOrigen = db.prepare(`
    SELECT origen,
           COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto END), 0) AS ingresos,
           COALESCE(SUM(CASE WHEN tipo = 'egreso'  THEN monto END), 0) AS egresos
    FROM caja_movimientos WHERE sesion_id = ? AND ${SOLO_EFECTIVO}
    GROUP BY origen
  `).all(sesionId);

  // Lo cobrado en esta caja por cada medio: el cuadro que se mira al cerrar
  // ("tanto en efectivo, tanto por Llave, tanto por QR"). Solo cobros y sus
  // anulaciones; lo escrito a mano es gasto o base del cajon, no un cobro, y ya
  // esta en los ingresos y egresos del arqueo.
  const porMedio = db.prepare(`
    SELECT metodo AS medio,
           COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto END), 0) AS ingresos,
           COALESCE(SUM(CASE WHEN tipo = 'egreso'  THEN monto END), 0) AS egresos
    FROM caja_movimientos WHERE sesion_id = ? AND origen <> 'manual'
    GROUP BY metodo
  `).all(sesionId)
    .map(f => ({ ...f, neto: f.ingresos - f.egresos, enCajon: esEfectivo(f.medio) }))
    .sort((a, b) => (b.enCajon - a.enCajon) || (b.neto - a.neto));
  const totalCobrado = porMedio.reduce((s, f) => s + f.neto, 0);

  return {
    sesion,
    ingresos: totales.ingresos,
    egresos: totales.egresos,
    esperado,
    porOrigen,
    porMedio,
    totalCobrado,
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

  const { esperado, porMedio, totalCobrado } = resumen(sesion.id);
  // Positiva = sobra dinero, negativa = falta. Se guarda aunque sea cero: que el
  // arqueo cuadre es un hecho que vale la pena poder consultar despues.
  const diferencia = efectivoContado - esperado;

  getDb().prepare(`
    UPDATE caja_sesiones
    SET cerrada_en = ?, efectivo_contado = ?, diferencia = ?, nota = ?
    WHERE id = ?
  `).run(new Date().toISOString(), efectivoContado, diferencia, nota || null, sesion.id);

  return { ok: true, sesionId: sesion.id, esperado, efectivoContado, diferencia, porMedio, totalCobrado };
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
