const { getDb } = require('../connection');
const productos = require('./productos');
const caja = require('./caja');
const { esEfectivo, esMedioValido } = require('../../services/medios-pago');

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

  // Sin caja abierta el efectivo no tiene donde registrarse, y una venta en
  // efectivo fuera de sesion descuadra el arqueo sin dejar rastro. Las ventas
  // que no son en efectivo no tocan el cajon, asi que pasan igual.
  const enEfectivo = esEfectivo(metodoPago);
  if (enEfectivo && !caja.sesionAbierta()) {
    return { ok: false, motivo: 'sin_caja_abierta' };
  }

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

      detalle.push({
        productoId,
        nombre: producto.nombre,
        cantidad,
        pUnitario: producto.p_venta,
        pCostoUnit: producto.p_costo,
      });
      total += producto.p_venta * cantidad;
    }

    const info = db.prepare(`
      INSERT INTO ventas (fecha, total, metodo_pago, usuario_id, cliente_id, anulada)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(fecha, total, metodoPago, usuarioId, clienteId || null);
    const ventaId = info.lastInsertRowid;

    const insertarItem = db.prepare(`
      INSERT INTO venta_items (venta_id, producto_id, producto_nombre, cantidad, p_unitario, p_costo_unit)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const d of detalle) {
      insertarItem.run(ventaId, d.productoId, d.nombre, d.cantidad, d.pUnitario, d.pCostoUnit);
    }

    if (enEfectivo) {
      const mov = caja.registrarMovimiento({
        tipo: 'ingreso',
        concepto: 'Venta #' + ventaId,
        monto: total,
        usuarioId,
      });
      // Si la caja rechaza, cae toda la venta: el stock descontado y la venta sin
      // su ingreso serian dos descuadres a la vez.
      if (!mov.ok) throw new VentaRechazada(mov.motivo);
    }

    return { ok: true, ventaId, total };
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

function listarDelDia(fecha) {
  return getDb().prepare(`
    SELECT v.*, u.nombre AS usuario_nombre, c.nombre AS cliente_nombre
    FROM ventas v
    LEFT JOIN usuarios u ON u.id = v.usuario_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE date(v.fecha) = date(?)
    ORDER BY v.fecha DESC, v.id DESC
  `).all(fecha);
}

function totalesDelDia(fecha) {
  return getDb().prepare(`
    SELECT
      COUNT(*) AS numVentas,
      COALESCE(SUM(total), 0) AS total
    FROM ventas
    WHERE date(fecha) = date(?) AND anulada = 0
  `).get(fecha);
}

// Anular devuelve el stock y, si la venta fue en efectivo, saca el dinero del
// cajon con un egreso. No se borra la venta: queda marcada, porque el historial
// de lo que se anulo y cuando es justamente lo que hay que poder auditar.
function anular({ ventaId, usuarioId, motivo }) {
  const db = getDb();
  const venta = db.prepare(`SELECT * FROM ventas WHERE id = ?`).get(ventaId);
  if (!venta) return { ok: false, motivo: 'venta_no_existe' };
  if (venta.anulada) return { ok: false, motivo: 'ya_anulada' };

  const devuelveEfectivo = esEfectivo(venta.metodo_pago);
  if (devuelveEfectivo && !caja.sesionAbierta()) {
    return { ok: false, motivo: 'sin_caja_abierta' };
  }

  const tx = db.transaction(() => {
    const items = db.prepare(`SELECT * FROM venta_items WHERE venta_id = ?`).all(ventaId);
    for (const item of items) {
      productos.moverStock({
        productoId: item.producto_id,
        delta: item.cantidad,
        motivo: 'anulacion de venta #' + ventaId,
        usuarioId,
      });
    }

    db.prepare(`UPDATE ventas SET anulada = 1 WHERE id = ?`).run(ventaId);
    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'venta_anulada', 'ventas', ?, ?, ?)
    `).run(usuarioId || null, ventaId, new Date().toISOString(),
           JSON.stringify({ motivo: motivo || null, total: venta.total, metodoPago: venta.metodo_pago }));

    if (devuelveEfectivo) {
      const mov = caja.registrarMovimiento({
        tipo: 'egreso',
        concepto: 'Anulacion de venta #' + ventaId,
        monto: venta.total,
        usuarioId,
      });
      if (!mov.ok) throw new VentaRechazada(mov.motivo);
    }

    return { ok: true, ventaId, devuelto: venta.total };
  });

  try {
    return tx();
  } catch (e) {
    if (e instanceof VentaRechazada) return { ok: false, motivo: e.motivo };
    throw e;
  }
}

module.exports = { registrar, obtener, listarDelDia, totalesDelDia, anular };
