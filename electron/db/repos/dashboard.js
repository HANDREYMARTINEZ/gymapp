const { format } = require('date-fns');
const { getDb } = require('../connection');
const { estadoMembresia } = require('../../services/membresias-logica');
const { hayPausaActiva } = require('./pausas');
const { calcularSaldoPendiente } = require('./membresias');
const productos = require('./productos');
const caja = require('./caja');
const { FIADO } = require('../../services/medios-pago');

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

  // Se suma linea a linea y no ventas.total porque un mismo ticket puede llevar
  // cosas del gimnasio y cosas que no lo son. Aqui solo cuenta lo del gimnasio:
  // meter lo de fuera inflaria los ingresos con dinero que no es del negocio.
  //
  // Lo fiado NO es ingreso el dia que se fia: no entro un peso. Entra el dia que se
  // cobra, por el medio con que se cobre, y solo la parte del gimnasio (`dentro`
  // del abono). Es el mismo criterio que ya seguian las membresias, que cuentan
  // por pagos y no por venta.
  const ventasDirectas = db.prepare(`
    SELECT v.metodo_pago AS medio,
           COUNT(DISTINCT v.id) AS n,
           COALESCE(SUM(i.cantidad * i.p_unitario), 0) AS monto
    FROM ventas v JOIN venta_items i ON i.venta_id = v.id
    WHERE date(v.fecha, 'localtime') = ? AND v.anulada = 0 AND i.fuera_de_caja = 0
      AND LOWER(v.metodo_pago) <> LOWER(?)
    GROUP BY v.metodo_pago
    HAVING monto > 0
  `).all(fecha, FIADO);

  const cobrosDeFiados = db.prepare(`
    SELECT a.metodo AS medio, COUNT(*) AS n, COALESCE(SUM(a.dentro), 0) AS monto,
           COALESCE(SUM(a.monto - a.dentro), 0) AS fuera
    FROM venta_abonos a JOIN ventas v ON v.id = a.venta_id
    WHERE date(a.fecha, 'localtime') = ? AND a.anulada = 0 AND v.anulada = 0
    GROUP BY a.metodo
  `).all(fecha);

  const porMedio = new Map(ventasDirectas.map(f => [f.medio, { ...f }]));
  for (const c of cobrosDeFiados) {
    if (c.monto <= 0) continue;
    const f = porMedio.get(c.medio) || { medio: c.medio, n: 0, monto: 0 };
    f.n += c.n;
    f.monto += c.monto;
    porMedio.set(c.medio, f);
  }
  const ventasPorMedio = [...porMedio.values()].sort((a, b) => b.monto - a.monto);

  const fueraDirecto = db.prepare(`
    SELECT COALESCE(SUM(i.cantidad * i.p_unitario), 0) AS monto,
           COALESCE(SUM(i.cantidad), 0) AS unidades
    FROM ventas v JOIN venta_items i ON i.venta_id = v.id
    WHERE date(v.fecha, 'localtime') = ? AND v.anulada = 0 AND i.fuera_de_caja = 1
      AND LOWER(v.metodo_pago) <> LOWER(?)
  `).get(fecha, FIADO);
  const fueraDeCaja = {
    monto: fueraDirecto.monto + cobrosDeFiados.reduce((s, c) => s + c.fuera, 0),
    unidades: fueraDirecto.unidades,
  };

  // Lo que se fio hoy, aparte: salio mercancia pero no entro dinero.
  const fiadoHoy = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS monto
    FROM ventas WHERE date(fecha, 'localtime') = ? AND anulada = 0 AND LOWER(metodo_pago) = LOWER(?)
  `).get(fecha, FIADO);

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
    // Aparte y sin sumar al total: es dinero que se movio en el mostrador pero
    // no es del gimnasio.
    fueraDeCaja: { total: fueraDeCaja.monto, unidades: fueraDeCaja.unidades },
    fiado: { total: fiadoHoy.monto, ventas: fiadoHoy.n },
    total: totalVentas + totalMembresias,
  };
}

// --- Que se vendio, cosa por cosa -------------------------------------------

// "Tienda: $400.000" no dice si eso fue agua o proteina, y sin saberlo no se
// puede reponer bien. Estas dos abren cada uno de los dos bloques de ingreso
// por dentro, sin cambiar como se suman: siguen siendo las mismas dos fuentes.
//
// Se agrupa por producto_id y no por el nombre copiado en la linea, para que
// renombrar un producto no parta su fila en dos. El nombre que se muestra es el
// de la venta mas reciente: SQLite, en una consulta con MAX(), devuelve las
// columnas sueltas de la fila que gano ese maximo.
//
// Y se separa dentro/fuera de caja porque son dos dineros distintos. Si un
// producto cambio de categoria a mitad del dia, cada mitad va por su lado, que
// es lo mismo que ya hace el arqueo.
function productosVendidos(fechaLocal) {
  const fecha = fechaLocal || hoyLocal();
  return getDb().prepare(`
    SELECT i.producto_id     AS id,
           i.producto_nombre AS nombre,
           i.fuera_de_caja   AS fueraDeCaja,
           SUM(i.cantidad)                  AS unidades,
           SUM(i.cantidad * i.p_unitario)   AS monto,
           MAX(i.id)                        AS ultimaLinea
    FROM venta_items i JOIN ventas v ON v.id = i.venta_id
    WHERE date(v.fecha, 'localtime') = ? AND v.anulada = 0
    GROUP BY i.producto_id, i.fuera_de_caja
    ORDER BY monto DESC, nombre
  `).all(fecha);
}

// El equivalente para el otro bloque: que planes se cobraron hoy. Se agrupa por
// el nombre del plan copiado en la membresia, que es el que se le vendio al
// cliente aunque el plan haya cambiado de nombre despues.
function membresiasVendidas(fechaLocal) {
  const fecha = fechaLocal || hoyLocal();
  return getDb().prepare(`
    SELECT m.plan_nombre AS nombre,
           m.plan_tipo   AS tipo,
           COUNT(*)                    AS pagos,
           COALESCE(SUM(p.monto), 0)   AS monto
    FROM pagos p JOIN membresias m ON m.id = p.membresia_id
    WHERE date(p.fecha, 'localtime') = ? AND p.anulada = 0
    GROUP BY m.plan_nombre, m.plan_tipo
    ORDER BY monto DESC, nombre
  `).all(fecha);
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
    // El detalle de las dos fuentes: que productos y que planes. Va dentro del
    // mismo resumen para que la pantalla siga pidiendo una sola cosa.
    vendido: {
      productos: productosVendidos(fechaLocal),
      membresias: membresiasVendidas(fechaLocal),
    },
    asistenciasHoy: asistenciasDelDia(fechaLocal),
    asistenciasSerie: asistenciasUltimosDias(diasSerie),
    porVencer: membresiasPorVencer(diasAviso),
    bajoMinimo: productos.listarBajoMinimo(),
    caja: sesion ? caja.resumen(sesion.id) : null,
  };
}

module.exports = {
  hoyLocal, ingresosDelDia, productosVendidos, membresiasVendidas,
  asistenciasDelDia, asistenciasUltimosDias, membresiasPorVencer, resumen,
};
