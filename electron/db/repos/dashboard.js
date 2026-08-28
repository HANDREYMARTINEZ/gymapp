const { format } = require('date-fns');
const { getDb } = require('../connection');
const { estadoMembresia } = require('../../services/membresias-logica');
const { hayPausaActiva } = require('./pausas');
const { calcularSaldoPendiente } = require('./membresias');
const productos = require('./productos');
const caja = require('./caja');

// Todas las fechas que salen de aqui son LOCALES ('YYYY-MM-DD'). Las columnas
// de timestamp se guardan en UTC con toISOString(), asi que se agrupan con
// date(col, 'localtime'): sin eso, en UTC-5 las ventas de la tarde caian en el
// dia siguiente. asistencias.fecha ya se guarda como fecha local, y por eso es
// la unica que se compara sin el modificador.

function hoyLocal() {
  return format(new Date(), 'yyyy-MM-dd');
}

// --- Dinero del dia ---------------------------------------------------------

// Ventas de productos y pagos de membresia son dos fuentes distintas y no se
// solapan, asi que se pueden sumar. Se listan aparte igualmente: "entraron
// $400.000" contesta menos que saber cuanto vino de la tienda y cuanto de
// membresias, que es lo que dice si el mes va bien.
function ingresosDelDia(fechaLocal) {
  const db = getDb();
  const fecha = fechaLocal || hoyLocal();

  const ventasPorMedio = db.prepare(`
    SELECT metodo_pago AS medio, COUNT(*) AS n, COALESCE(SUM(total), 0) AS monto
    FROM ventas
    WHERE date(fecha, 'localtime') = ? AND anulada = 0
    GROUP BY metodo_pago
    ORDER BY monto DESC
  `).all(fecha);

  const membresiasPorMedio = db.prepare(`
    SELECT metodo AS medio, COUNT(*) AS n, COALESCE(SUM(monto), 0) AS monto
    FROM pagos
    WHERE date(fecha, 'localtime') = ? AND anulada = 0
    GROUP BY metodo
    ORDER BY monto DESC
  `).all(fecha);

  const sumar = (filas) => filas.reduce((s, f) => s + f.monto, 0);
  const totalVentas = sumar(ventasPorMedio);
  const totalMembresias = sumar(membresiasPorMedio);

  return {
    fecha,
    ventas: { porMedio: ventasPorMedio, total: totalVentas },
    membresias: { porMedio: membresiasPorMedio, total: totalMembresias },
    total: totalVentas + totalMembresias,
  };
}

// --- Asistencias ------------------------------------------------------------

function asistenciasDelDia(fechaLocal) {
  const fecha = fechaLocal || hoyLocal();
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM asistencias WHERE fecha = ?`).get(fecha);
  return row.n;
}

// Devuelve un punto por dia aunque no haya habido asistencias: si se omitieran
// los ceros, una semana con dos dias cerrados se veria igual que una semana
// entera floja.
function asistenciasUltimosDias(dias = 7) {
  const db = getDb();
  const conteos = new Map(
    db.prepare(`
      SELECT fecha, COUNT(*) AS n
      FROM asistencias
      WHERE fecha >= date('now', 'localtime', ?)
      GROUP BY fecha
    `).all('-' + (dias - 1) + ' days').map(r => [r.fecha, r.n])
  );

  const serie = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const fecha = format(d, 'yyyy-MM-dd');
    serie.push({ fecha, n: conteos.get(fecha) || 0 });
  }
  return serie;
}

// --- Membresias por vencer --------------------------------------------------

// El estado real de una membresia depende tambien de pausas y saldo pendiente,
// asi que no se decide en SQL: la consulta solo acota candidatos baratos y el
// estado lo dicta estadoMembresia(), que es el mismo que usan el kiosco y la
// ficha del cliente. Reimplementarlo aqui seria tener dos definiciones de
// "por vencer" que tarde o temprano dejan de coincidir.
function membresiasPorVencer(diasAviso = 5) {
  const db = getDb();
  const hoy = hoyLocal();

  const candidatas = db.prepare(`
    SELECT m.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
    FROM membresias m JOIN clientes c ON c.id = m.cliente_id
    WHERE m.anulada = 0 AND c.activo = 1
      AND (
        (m.plan_tipo = 'periodo'   AND m.f_fin >= ? AND m.f_fin <= date(?, ?))
        OR
        (m.plan_tipo = 'ticketera' AND (m.tickets_totales - m.tickets_usados) <= 2
                                   AND (m.f_fin IS NULL OR m.f_fin >= ?))
      )
    ORDER BY m.f_fin
  `).all(hoy, hoy, '+' + diasAviso + ' days', hoy);

  return candidatas
    .map(m => {
      const saldo = calcularSaldoPendiente(m.id);
      const estado = estadoMembresia(m, hoy, hayPausaActiva(m.id), saldo, diasAviso);
      return {
        id: m.id,
        clienteId: m.cliente_id,
        clienteNombre: m.cliente_nombre,
        clienteTelefono: m.cliente_telefono,
        planNombre: m.plan_nombre,
        planTipo: m.plan_tipo,
        fFin: m.f_fin,
        ticketsRestantes: m.plan_tipo === 'ticketera' ? m.tickets_totales - m.tickets_usados : null,
        estado,
      };
    })
    .filter(m => m.estado === 'por_vencer');
}

// --- Resumen ----------------------------------------------------------------

function resumen({ fecha, diasAviso = 5, diasSerie = 7 } = {}) {
  const fechaLocal = fecha || hoyLocal();
  const sesion = caja.sesionAbierta();

  return {
    fecha: fechaLocal,
    ingresos: ingresosDelDia(fechaLocal),
    asistenciasHoy: asistenciasDelDia(fechaLocal),
    asistenciasSerie: asistenciasUltimosDias(diasSerie),
    porVencer: membresiasPorVencer(diasAviso),
    bajoMinimo: productos.listarBajoMinimo(),
    caja: sesion ? caja.resumen(sesion.id) : null,
  };
}

module.exports = {
  hoyLocal, ingresosDelDia, asistenciasDelDia, asistenciasUltimosDias,
  membresiasPorVencer, resumen,
};
