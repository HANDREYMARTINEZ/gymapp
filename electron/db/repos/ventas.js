const { getDb } = require('../connection');
const productos = require('./productos');
const caja = require('./caja');
const { esEfectivo, esMedioValido } = require('../../services/medios-pago');

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

function registrar({ items, metodoPago, usuarioId, clienteId }) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, motivo: 'sin_items' };
  }
  if (!esMedioValido(metodoPago)) {
    return { ok: false, motivo: 'medio_pago_invalido' };
  }
  for (const item of items) {
    if (!item.productoId || !item.cantidad || item.cantidad <= 0) {
      return { ok: false, motivo: 'cantidad_invalida' };
    }
  }

  const enEfectivo = esEfectivo(metodoPago);
  const db = getDb();

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

    // Solo se exige caja abierta si hay efectivo que meter en el cajon. Un ticket
    // entero de cosas de fuera no toca la caja del gimnasio, asi que pedirle una
    // sesion abierta seria bloquear una venta por un arqueo que no le incumbe.
    if (enEfectivo && totalDentro > 0 && !caja.sesionAbierta()) {
      throw new VentaRechazada('sin_caja_abierta');
    }

    const info = db.prepare(`
      INSERT INTO ventas (fecha, total, metodo_pago, usuario_id, cliente_id, anulada)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(fecha, total, metodoPago, usuarioId, clienteId || null);
    const ventaId = info.lastInsertRowid;

    const insertarItem = db.prepare(`
      INSERT INTO venta_items (venta_id, producto_id, producto_nombre, cantidad, p_unitario, p_costo_unit, fuera_de_caja)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of detalle) {
      insertarItem.run(ventaId, d.productoId, d.nombre, d.cantidad, d.pUnitario, d.pCostoUnit, d.fuera);
    }

    // Al cajon entra solo la parte del gimnasio. Meter el total completo seria
    // exactamente el sobrante falso que este reparto viene a evitar.
    if (enEfectivo && totalDentro > 0) {
      const mov = caja.registrarMovimiento({
        tipo: 'ingreso',
        concepto: 'Venta #' + ventaId,
        monto: totalDentro,
        usuarioId,
        origen: 'venta',
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
  const devuelveEfectivo = esEfectivo(venta.metodo_pago) && reparto.dentro > 0;
  if (devuelveEfectivo && !caja.sesionAbierta()) {
    return { ok: false, motivo: 'sin_caja_abierta' };
  }

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
    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'venta_anulada', 'ventas', ?, ?, ?)
    `).run(usuarioId || null, ventaId, new Date().toISOString(),
           JSON.stringify({ motivo: motivo || null, total: venta.total, metodoPago: venta.metodo_pago,
                            dentroDeCaja: reparto.dentro, fueraDeCaja: reparto.fuera }));

    if (devuelveEfectivo) {
      const mov = caja.registrarMovimiento({
        tipo: 'egreso',
        concepto: 'Anulación de venta #' + ventaId,
        monto: reparto.dentro,
        usuarioId,
        origen: 'venta',
      });
      if (!mov.ok) throw new VentaRechazada(mov.motivo);
    }

    return { ok: true, ventaId, devuelto: reparto.dentro, fueraDeCaja: reparto.fuera };
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
};
