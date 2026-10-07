const { getDb } = require('../connection');
const productos = require('./productos');
const caja = require('./caja');
const { format, parseISO } = require('date-fns');
const { esEfectivo, esMedioValido, esFiado, FIADO } = require('../../services/medios-pago');

function hoyLocal() {
  return format(new Date(), 'yyyy-MM-dd');
}

// 'YYYY-MM-DD' que exista de verdad (no 2026-02-31), o null.
function fechaValida(f) {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  const d = parseISO(f);
  return !Number.isNaN(d.getTime()) && format(d, 'yyyy-MM-dd') === f ? f : null;
}

// Una venta puede llevar cosas del gimnasio y cosas que no lo son, en el mismo
// ticket. Por eso no hay un solo total sino dos: lo que entra al negocio y al
// arqueo, y lo que se cobra igual pero se lleva aparte. Solo el primero llega a
// caja_movimientos; el segundo existe para poder mirarlo en su propio resumen.
//
// La venta guarda el nombre y los precios del momento en venta_items, no solo el
// producto_id. Si manana sube el precio o se renombra el producto, la venta de
// ayer tiene que seguir contando lo que de verdad se cobro. El p_costo_unit va
// por lo mismo: el margen de una venta es el de ese dia, no el de hoy.

class VentaRechazada extends Error {
  constructor(motivo, extra) {
    super('venta_rechazada:' + motivo);
    this.motivo = motivo;
    this.extra = extra || {};
  }
}

function registrar({ items, metodoPago, usuarioId, clienteId, fiadoHasta }) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, motivo: 'sin_items' };
  }
  const fiado = esFiado(metodoPago);
  if (!fiado && !esMedioValido(metodoPago)) {
    return { ok: false, motivo: 'medio_pago_invalido' };
  }
  // Entera, positiva y con el mismo tope que la entrada de mercancia. Sin esto
  // una cantidad con decimales dejaba el stock en 7,5 unidades, y un codigo de
  // barras tecleado por error en la casilla de la cantidad pedia miles de
  // millones de unidades.
  for (const item of items) {
    const cantidad = Number(item && item.cantidad);
    if (!item || !item.productoId || !Number.isInteger(cantidad)
        || cantidad <= 0 || cantidad > productos.MAX_CANTIDAD_POR_LINEA) {
      return { ok: false, motivo: 'cantidad_invalida' };
    }
  }

  const db = getDb();

  // Un fiado sin cliente es una deuda que no se le puede cobrar a nadie. Tampoco a
  // uno dado de baja: no sale en las busquedas ni en la lista de quienes deben, y
  // la deuda quedaria escondida.
  let fechaFiado = null;
  if (fiado) {
    const cliente = clienteId ? db.prepare(`SELECT id, activo FROM clientes WHERE id = ?`).get(clienteId) : null;
    if (!cliente || !cliente.activo) return { ok: false, motivo: 'fiado_sin_cliente' };
    if (fiadoHasta) {
      fechaFiado = fechaValida(fiadoHasta);
      if (!fechaFiado) return { ok: false, motivo: 'fecha_invalida' };
      if (fechaFiado < hoyLocal()) return { ok: false, motivo: 'fecha_pasada' };
    }
  }

  // Lo fiado no entra a la caja hoy: entra cuando se cobre (abonar). Todo lo
  // demas entra con su medio; solo el efectivo cuenta para el arqueo.
  const aCaja = !fiado;

  const tx = db.transaction(() => {
    const fecha = new Date().toISOString();

    // Se agrupa por producto antes de tocar el stock: dos lineas del mismo
    // producto tienen que validarse contra la suma, no cada una por su lado, o
    // dos lineas de 3 pasarian con 4 unidades en existencia.
    const porProducto = new Map();
    for (const item of items) {
      porProducto.set(item.productoId, (porProducto.get(item.productoId) || 0) + item.cantidad);
    }

    const detalle = [];
    let total = 0;
    let totalDentro = 0;
    let totalFuera = 0;

    for (const [productoId, cantidad] of porProducto) {
      const producto = productos.obtenerPorId(productoId);
      if (!producto) throw new VentaRechazada('producto_no_existe', { productoId });
      if (!producto.activo) throw new VentaRechazada('producto_inactivo', { productoId, nombre: producto.nombre });

      const mov = productos.moverStock({
        productoId,
        delta: -cantidad,
        motivo: 'venta',
        usuarioId,
      });
      if (!mov.ok) {
        throw new VentaRechazada(mov.motivo, {
          productoId, nombre: producto.nombre, stockActual: mov.stockActual,
        });
      }

      const fuera = producto.fuera_de_caja ? 1 : 0;
      const importe = producto.p_venta * cantidad;

      detalle.push({
        productoId,
        nombre: producto.nombre,
        cantidad,
        pUnitario: producto.p_venta,
        pCostoUnit: producto.p_costo,
        fuera,
      });
      total += importe;
      if (fuera) totalFuera += importe; else totalDentro += importe;
    }

    // Solo se exige caja abierta si hay algo del gimnasio que anotar en ella. Un
    // ticket entero de cosas de fuera no toca la caja del gimnasio, asi que
    // pedirle una sesion abierta seria bloquear una venta que no le incumbe.
    if (aCaja && totalDentro > 0 && !caja.sesionAbierta()) {
      throw new VentaRechazada('sin_caja_abierta');
    }

    const info = db.prepare(`
      INSERT INTO ventas (fecha, total, metodo_pago, usuario_id, cliente_id, anulada, fiado_hasta)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(fecha, total, fiado ? FIADO : metodoPago, usuarioId, clienteId || null, fechaFiado);
    const ventaId = info.lastInsertRowid;

    const insertarItem = db.prepare(`
      INSERT INTO venta_items (venta_id, producto_id, producto_nombre, cantidad, p_unitario, p_costo_unit, fuera_de_caja)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of detalle) {
      insertarItem.run(ventaId, d.productoId, d.nombre, d.cantidad, d.pUnitario, d.pCostoUnit, d.fuera);
    }

    // A la caja entra solo la parte del gimnasio. Meter el total completo seria
    // exactamente el sobrante falso que este reparto viene a evitar.
    if (aCaja && totalDentro > 0) {
      const mov = caja.registrarMovimiento({
        tipo: 'ingreso',
        concepto: 'Venta #' + ventaId,
        monto: totalDentro,
        usuarioId,
        origen: 'venta',
        metodo: metodoPago,
      });
      // Si la caja rechaza, cae toda la venta: el stock descontado y la venta sin
      // su ingreso serian dos descuadres a la vez.
      if (!mov.ok) throw new VentaRechazada(mov.motivo);
    }

    return { ok: true, ventaId, total, totalDentro, totalFuera };
  });

  try {
    return tx();
  } catch (e) {
    if (e instanceof VentaRechazada) {
      return { ok: false, motivo: e.motivo, ...e.extra };
    }
    throw e;
  }
}

// Cuanto de una venta ya guardada era del gimnasio y cuanto no. Se lee de la
// marca copiada en la linea, no de la del producto de hoy: eso es lo que hace
// que un arqueo cerrado la semana pasada siga cuadrando aunque el producto haya
// cambiado de categoria desde entonces.
function repartoDe(ventaId) {
  const fila = getDb().prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN fuera_de_caja = 0 THEN cantidad * p_unitario ELSE 0 END), 0) AS dentro,
      COALESCE(SUM(CASE WHEN fuera_de_caja = 1 THEN cantidad * p_unitario ELSE 0 END), 0) AS fuera
    FROM venta_items WHERE venta_id = ?
  `).get(ventaId);
  return fila || { dentro: 0, fuera: 0 };
}

// ------------------------------------------------------------------ fiados
//
// Lo que falta por cobrar de una venta fiada: el total menos los abonos vivos.
// Para una venta que no es fiada, o anulada, no hay nada que cobrar.
function saldoFiado(ventaId) {
  const db = getDb();
  const venta = db.prepare(`SELECT * FROM ventas WHERE id = ?`).get(ventaId);
  if (!venta || venta.anulada || !esFiado(venta.metodo_pago)) return null;
  const abonos = db.prepare(`
    SELECT COALESCE(SUM(monto), 0) AS monto, COALESCE(SUM(dentro), 0) AS dentro
    FROM venta_abonos WHERE venta_id = ? AND anulada = 0
  `).get(ventaId);
  return {
    venta,
    abonado: abonos.monto,
    abonadoDentro: abonos.dentro,
    saldo: venta.total - abonos.monto,
  };
}

// Cobrar (todo o parte de) una venta fiada. El abono paga primero la parte del
// gimnasio y despues la de fuera de caja: asi, si el ticket mezcla las dos, lo
// que entra al cajon nunca pasa de lo que es del gimnasio, y las cuentas salen
// en pesos enteros sin repartir proporciones.
//
// Pensada para llamarse sola o dentro de otra transaccion (cobrar la cuenta
// entera de un cliente): lanza AbonoRechazado en vez de devolver, para que la
// transaccion de fuera se tumbe entera.
class AbonoRechazado extends Error {
  constructor(motivo, extra) {
    super('abono_rechazado:' + motivo);
    this.motivo = motivo;
    this.extra = extra || {};
  }
}

function abonarSinAtrapar({ ventaId, monto, metodo, usuarioId, nota }) {
  const n = parseInt(monto, 10);
  if (!Number.isInteger(n) || n <= 0) throw new AbonoRechazado('monto_invalido');
  if (!esMedioValido(metodo)) throw new AbonoRechazado('medio_pago_invalido');

  const estado = saldoFiado(ventaId);
  if (!estado) throw new AbonoRechazado('no_es_fiado');
  if (n > estado.saldo) throw new AbonoRechazado('mas_que_el_saldo', { saldo: estado.saldo });

  const db = getDb();
  const reparto = repartoDe(ventaId);
  const dentroPendiente = Math.max(0, reparto.dentro - estado.abonadoDentro);
  const dentro = Math.min(n, dentroPendiente);
  // Todo cobro del gimnasio entra a la caja con su medio; alCajon dice solo
  // cuanto de eso es efectivo, que es lo que se devuelve al anular.
  const aCaja = dentro > 0;
  const alCajon = esEfectivo(metodo) && aCaja;

  if (aCaja && !caja.sesionAbierta()) throw new AbonoRechazado('sin_caja_abierta');

  const info = db.prepare(`
    INSERT INTO venta_abonos (venta_id, monto, dentro, metodo, fecha, usuario_id, nota, anulada)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(ventaId, n, dentro, metodo, new Date().toISOString(), usuarioId || null, nota || null);

  if (aCaja) {
    const mov = caja.registrarMovimiento({
      tipo: 'ingreso',
      concepto: 'Cobro de fiado, venta #' + ventaId,
      monto: dentro,
      usuarioId,
      origen: 'venta',
      metodo,
    });
    if (!mov.ok) throw new AbonoRechazado(mov.motivo);
  }

  return { ok: true, abonoId: info.lastInsertRowid, monto: n, dentro, alCajon: alCajon ? dentro : 0,
           saldo: estado.saldo - n };
}

function abonar(datos) {
  try {
    return getDb().transaction(() => abonarSinAtrapar(datos || {}))();
  } catch (e) {
    if (e instanceof AbonoRechazado) return { ok: false, motivo: e.motivo, ...e.extra };
    throw e;
  }
}

// Las ventas fiadas que aun se deben, de un cliente o de todos.
function fiadasPendientes(clienteId) {
  const db = getDb();
  const filas = db.prepare(`
    SELECT v.*,
           COALESCE((SELECT SUM(a.monto) FROM venta_abonos a WHERE a.venta_id = v.id AND a.anulada = 0), 0) AS abonado
    FROM ventas v
    WHERE v.anulada = 0 AND LOWER(v.metodo_pago) = LOWER(?)
      ${clienteId ? 'AND v.cliente_id = ?' : 'AND v.cliente_id IS NOT NULL'}
    ORDER BY v.fecha, v.id
  `).all(...(clienteId ? [FIADO, clienteId] : [FIADO]));

  const lineas = db.prepare(`SELECT producto_nombre, cantidad FROM venta_items WHERE venta_id = ? ORDER BY id`);
  return filas
    .map(v => ({ ...v, saldo: v.total - v.abonado }))
    .filter(v => v.saldo > 0)
    .map(v => ({
      ...v,
      detalle: lineas.all(v.id).map(l => l.cantidad + ' ' + l.producto_nombre).join(', '),
    }));
}

function listarAbonos(ventaId) {
  return getDb().prepare(`
    SELECT a.*, u.nombre AS usuario_nombre FROM venta_abonos a
    LEFT JOIN usuarios u ON u.id = a.usuario_id
    WHERE a.venta_id = ? ORDER BY a.fecha, a.id
  `).all(ventaId);
}

// Los cobros de fiados de un dia, para la Caja: es dinero que entra hoy aunque la
// venta sea de otro dia.
function abonosDelDia(fechaLocal) {
  const filas = getDb().prepare(`
    SELECT a.*, v.cliente_id, c.nombre AS cliente_nombre, u.nombre AS usuario_nombre
    FROM venta_abonos a
    JOIN ventas v ON v.id = a.venta_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN usuarios u ON u.id = a.usuario_id
    WHERE date(a.fecha, 'localtime') = ? AND a.anulada = 0
    ORDER BY a.fecha DESC, a.id DESC
  `).all(fechaLocal);
  return { fecha: fechaLocal, abonos: filas, total: filas.reduce((s, a) => s + a.monto, 0) };
}

function obtener(ventaId) {
  const db = getDb();
  const venta = db.prepare(`
    SELECT v.*, u.nombre AS usuario_nombre, c.nombre AS cliente_nombre
    FROM ventas v
    LEFT JOIN usuarios u ON u.id = v.usuario_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE v.id = ?
  `).get(ventaId);
  if (!venta) return null;

  venta.items = db.prepare(`SELECT * FROM venta_items WHERE venta_id = ? ORDER BY id`).all(ventaId);
  if (esFiado(venta.metodo_pago)) {
    venta.abonos = listarAbonos(ventaId);
    venta.saldo = venta.total - venta.abonos.filter(a => !a.anulada).reduce((s, a) => s + a.monto, 0);
  }
  return venta;
}

// ventas.fecha se guarda con toISOString(), que es UTC. Comparar con date() a
// secas agrupaba por dia UTC: en Colombia (UTC-5) una venta de las 7 de la noche
// cae a la 1 UTC del dia siguiente y se contaba como del dia siguiente --
// justo las ventas de la tarde, que son las que se revisan al cerrar.
// El modificador 'localtime' agrupa por el dia que vio el cajero.
// Ambas reciben una fecha local 'YYYY-MM-DD', no un timestamp.
function listarDelDia(fechaLocal) {
  return getDb().prepare(`
    SELECT v.*, u.nombre AS usuario_nombre, c.nombre AS cliente_nombre
    FROM ventas v
    LEFT JOIN usuarios u ON u.id = v.usuario_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE date(v.fecha, 'localtime') = ?
    ORDER BY v.fecha DESC, v.id DESC
  `).all(fechaLocal);
}

// total sigue siendo lo cobrado en el mostrador, que es lo que ve el asistente.
// dentro es lo que cuenta para el gimnasio y para el arqueo; fuera es el resto.
// Se devuelven los tres para que ninguna pantalla tenga que restarlos a mano.
function totalesDelDia(fechaLocal) {
  const db = getDb();
  const cabecera = db.prepare(`
    SELECT COUNT(*) AS numVentas, COALESCE(SUM(total), 0) AS total
    FROM ventas
    WHERE date(fecha, 'localtime') = ? AND anulada = 0
  `).get(fechaLocal);

  const reparto = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN i.fuera_de_caja = 0 THEN i.cantidad * i.p_unitario ELSE 0 END), 0) AS dentro,
      COALESCE(SUM(CASE WHEN i.fuera_de_caja = 1 THEN i.cantidad * i.p_unitario ELSE 0 END), 0) AS fuera
    FROM venta_items i JOIN ventas v ON v.id = i.venta_id
    WHERE date(v.fecha, 'localtime') = ? AND v.anulada = 0
  `).get(fechaLocal);

  return { ...cabecera, dentro: reparto.dentro, fuera: reparto.fuera };
}

// El historial aparte que pidio el mostrador: que se vendio de lo que no es del
// gimnasio, sin mezclarlo con el arqueo.
//
// Un mes entero puede traer miles de lineas, y la pantalla solo dibuja una
// tabla. Por eso las lineas se cortan en TOPE_LINEAS y los totales se calculan
// en SQL sobre TODO el rango: si se sumaran las lineas ya recortadas, el total
// de un rango largo saldria corto sin que nada avisara.
const TOPE_LINEAS = 500;

function fueraDeCajaEntre(desdeLocal, hastaLocal) {
  const db = getDb();
  // Fechas al reves ('del 30 al 1') se enderezan en vez de devolver vacio.
  const a = desdeLocal;
  const b = hastaLocal || desdeLocal;
  const desde = a <= b ? a : b;
  const hasta = a <= b ? b : a;

  const DONDE = `i.fuera_de_caja = 1 AND v.anulada = 0
                 AND date(v.fecha, 'localtime') BETWEEN ? AND ?`;

  const lineas = db.prepare(`
    SELECT i.*, v.fecha, v.metodo_pago, v.anulada, u.nombre AS usuario_nombre
    FROM venta_items i
    JOIN ventas v ON v.id = i.venta_id
    LEFT JOIN usuarios u ON u.id = v.usuario_id
    WHERE ${DONDE}
    ORDER BY v.fecha DESC, i.id DESC
    LIMIT ?
  `).all(desde, hasta, TOPE_LINEAS + 1);

  // Que producto fue, sumado en todo el rango. En un solo dia la lista de
  // lineas ya se lee entera; en un mes es lo unico que se lee.
  const porProducto = db.prepare(`
    SELECT i.producto_id AS id,
           i.producto_nombre AS nombre,
           SUM(i.cantidad) AS unidades,
           SUM(i.cantidad * i.p_unitario) AS monto,
           MAX(i.id) AS ultimaLinea
    FROM venta_items i JOIN ventas v ON v.id = i.venta_id
    WHERE ${DONDE}
    GROUP BY i.producto_id
    ORDER BY monto DESC, nombre
  `).all(desde, hasta);

  const totales = db.prepare(`
    SELECT COALESCE(SUM(i.cantidad * i.p_unitario), 0) AS total,
           COALESCE(SUM(i.cantidad), 0) AS unidades
    FROM venta_items i JOIN ventas v ON v.id = i.venta_id
    WHERE ${DONDE}
  `).get(desde, hasta);

  return {
    desde,
    hasta,
    lineas: lineas.slice(0, TOPE_LINEAS),
    truncado: lineas.length > TOPE_LINEAS,
    porProducto,
    total: totales.total,
    unidades: totales.unidades,
  };
}

// Un solo dia es el rango de un dia. Se conserva porque es lo que llaman la
// pantalla de Caja y las suites, y porque devuelve ademas 'fecha'.
function fueraDeCajaDelDia(fechaLocal) {
  return { fecha: fechaLocal, ...fueraDeCajaEntre(fechaLocal, fechaLocal) };
}

// Anular devuelve el stock y, si la venta fue en efectivo, saca el dinero del
// cajon con un egreso. No se borra la venta: queda marcada, porque el historial
// de lo que se anulo y cuando es justamente lo que hay que poder auditar.
function anular({ ventaId, usuarioId, motivo }) {
  const db = getDb();
  const venta = db.prepare(`SELECT * FROM ventas WHERE id = ?`).get(ventaId);
  if (!venta) return { ok: false, motivo: 'venta_no_existe' };
  if (venta.anulada) return { ok: false, motivo: 'ya_anulada' };

  // Solo hay que sacar del cajon lo que entro en el, que es la parte del
  // gimnasio. Devolver el total completo dejaria la caja corta por el importe de
  // lo que nunca estuvo dentro.
  const reparto = repartoDe(ventaId);
  // Una venta fiada no metio nada al cajon al venderse; lo que entro fue lo que se
  // cobro despues en efectivo, abono por abono, y eso es lo que se devuelve.
  const fiada = esFiado(venta.metodo_pago);
  const aDevolver = fiada
    ? db.prepare(`SELECT dentro, metodo FROM venta_abonos WHERE venta_id = ? AND anulada = 0`).all(ventaId)
        .filter(a => esEfectivo(a.metodo)).reduce((s, a) => s + a.dentro, 0)
    : (esEfectivo(venta.metodo_pago) ? reparto.dentro : 0);
  const devuelveEfectivo = aDevolver > 0;
  if (devuelveEfectivo && !caja.sesionAbierta()) {
    return { ok: false, motivo: 'sin_caja_abierta' };
  }

  // Lo cobrado por otros medios tambien entro a la caja, asi que tambien sale:
  // si no, el cuadro por medio de pago seguiria contando una venta anulada. No
  // se exige caja abierta para esto: no hay billetes que sacar del cajon, y sin
  // sesion no hay cuadro que corregir.
  const otrosMedios = new Map();
  const sumarMedio = (metodo, monto) => {
    if (esEfectivo(metodo) || monto <= 0) return;
    otrosMedios.set(metodo, (otrosMedios.get(metodo) || 0) + monto);
  };
  if (fiada) {
    db.prepare(`SELECT dentro, metodo FROM venta_abonos WHERE venta_id = ? AND anulada = 0`).all(ventaId)
      .forEach(a => sumarMedio(a.metodo, a.dentro));
  } else {
    sumarMedio(venta.metodo_pago, reparto.dentro);
  }
  const hayCaja = !!caja.sesionAbierta();

  const tx = db.transaction(() => {
    const items = db.prepare(`SELECT * FROM venta_items WHERE venta_id = ?`).all(ventaId);
    for (const item of items) {
      productos.moverStock({
        productoId: item.producto_id,
        delta: item.cantidad,
        motivo: 'anulación de venta #' + ventaId,
        usuarioId,
      });
    }

    db.prepare(`UPDATE ventas SET anulada = 1 WHERE id = ?`).run(ventaId);
    if (fiada) db.prepare(`UPDATE venta_abonos SET anulada = 1 WHERE venta_id = ? AND anulada = 0`).run(ventaId);
    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'venta_anulada', 'ventas', ?, ?, ?)
    `).run(usuarioId || null, ventaId, new Date().toISOString(),
           JSON.stringify({ motivo: motivo || null, total: venta.total, metodoPago: venta.metodo_pago,
                            dentroDeCaja: reparto.dentro, fueraDeCaja: reparto.fuera,
                            efectivoDevuelto: aDevolver }));

    if (devuelveEfectivo) {
      const mov = caja.registrarMovimiento({
        tipo: 'egreso',
        concepto: 'Anulación de venta #' + ventaId,
        monto: aDevolver,
        usuarioId,
        origen: 'venta',
      });
      if (!mov.ok) throw new VentaRechazada(mov.motivo);
    }

    if (hayCaja) {
      for (const [metodo, monto] of otrosMedios) {
        const mov = caja.registrarMovimiento({
          tipo: 'egreso',
          concepto: 'Anulación de venta #' + ventaId,
          monto,
          usuarioId,
          origen: 'venta',
          metodo,
        });
        if (!mov.ok) throw new VentaRechazada(mov.motivo);
      }
    }

    return { ok: true, ventaId, devuelto: aDevolver, fueraDeCaja: reparto.fuera };
  });

  try {
    return tx();
  } catch (e) {
    if (e instanceof VentaRechazada) return { ok: false, motivo: e.motivo };
    throw e;
  }
}

module.exports = {
  registrar, obtener, listarDelDia, totalesDelDia,
  fueraDeCajaDelDia, fueraDeCajaEntre, anular, TOPE_LINEAS,
  saldoFiado, abonar, abonarSinAtrapar, AbonoRechazado, fiadasPendientes, listarAbonos, abonosDelDia,
};
