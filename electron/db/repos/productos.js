const { getDb } = require('../connection');

// codigo_barras es UNIQUE pero opcional. Guardar '' en vez de NULL haria que el
// segundo producto sin codigo chocara contra el primero, asi que el vacio se
// normaliza a NULL: en SQLite varios NULL conviven bajo un indice UNIQUE.
function normalizarCodigo(codigo) {
  const limpio = (codigo || '').trim();
  return limpio === '' ? null : limpio;
}

function esChoqueDeCodigo(e) {
  return String(e.message).includes('UNIQUE') && String(e.message).includes('codigo_barras');
}

function crear(producto) {
  try {
    const info = getDb().prepare(`
      INSERT INTO productos (nombre, categoria, p_venta, p_costo, stock, stock_min, codigo_barras, activo)
      VALUES (@nombre, @categoria, @p_venta, @p_costo, @stock, @stock_min, @codigo_barras, 1)
    `).run({
      nombre: producto.nombre,
      categoria: producto.categoria || null,
      p_venta: producto.p_venta,
      p_costo: producto.p_costo || 0,
      stock: producto.stock || 0,
      stock_min: producto.stock_min || 0,
      codigo_barras: normalizarCodigo(producto.codigo_barras),
    });
    return { ok: true, id: info.lastInsertRowid };
  } catch (e) {
    if (esChoqueDeCodigo(e)) return { ok: false, motivo: 'codigo_duplicado' };
    throw e;
  }
}

function listar() {
  return getDb().prepare(`SELECT * FROM productos WHERE activo = 1 ORDER BY nombre`).all();
}

function listarTodos() {
  return getDb().prepare(`SELECT * FROM productos ORDER BY activo DESC, nombre`).all();
}

function obtenerPorId(id) {
  return getDb().prepare(`SELECT * FROM productos WHERE id = ?`).get(id);
}

function obtenerPorCodigo(codigo) {
  const normalizado = normalizarCodigo(codigo);
  if (!normalizado) return undefined;
  return getDb().prepare(`SELECT * FROM productos WHERE codigo_barras = ? AND activo = 1`).get(normalizado);
}

// El stock no se toca aqui: se mueve solo por ajustarStock o por una venta, que
// dejan rastro. Editarlo junto al precio lo volveria un campo mas del formulario
// y se perderia el porque de cada cambio.
function editar(id, cambios) {
  try {
    getDb().prepare(`
      UPDATE productos SET
        nombre = @nombre, categoria = @categoria,
        p_venta = @p_venta, p_costo = @p_costo,
        stock_min = @stock_min, codigo_barras = @codigo_barras
      WHERE id = @id
    `).run({
      id,
      nombre: cambios.nombre,
      categoria: cambios.categoria || null,
      p_venta: cambios.p_venta,
      p_costo: cambios.p_costo || 0,
      stock_min: cambios.stock_min || 0,
      codigo_barras: normalizarCodigo(cambios.codigo_barras),
    });
    return { ok: true };
  } catch (e) {
    if (esChoqueDeCodigo(e)) return { ok: false, motivo: 'codigo_duplicado' };
    throw e;
  }
}

function desactivar(id) {
  getDb().prepare(`UPDATE productos SET activo = 0 WHERE id = ?`).run(id);
  return true;
}

function activar(id) {
  getDb().prepare(`UPDATE productos SET activo = 1 WHERE id = ?`).run(id);
  return true;
}

// Un solo camino para mover stock, usado por los ajustes manuales y mas adelante
// por las ventas. Cada movimiento queda en auditoria: el stock dice cuanto hay,
// la auditoria dice por que.
function moverStock({ productoId, delta, motivo, usuarioId, entidad = 'productos' }) {
  const db = getDb();
  const tx = db.transaction(() => {
    const producto = db.prepare(`SELECT stock FROM productos WHERE id = ?`).get(productoId);
    if (!producto) return { ok: false, motivo: 'producto_no_existe' };

    const nuevo = producto.stock + delta;
    if (nuevo < 0) {
      return { ok: false, motivo: 'stock_insuficiente', stockActual: producto.stock };
    }

    db.prepare(`UPDATE productos SET stock = ? WHERE id = ?`).run(nuevo, productoId);
    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'stock_movido', ?, ?, ?, ?)
    `).run(
      usuarioId || null, entidad, productoId, new Date().toISOString(),
      JSON.stringify({ delta, motivo: motivo || null, stockAnterior: producto.stock, stockNuevo: nuevo })
    );

    return { ok: true, stockAnterior: producto.stock, stockNuevo: nuevo };
  });
  return tx();
}

function ajustarStock({ productoId, delta, motivo, usuarioId }) {
  return moverStock({ productoId, delta, motivo, usuarioId });
}

// El <= es deliberado, no un > mal escrito: un producto agotado (stock 0) avisa
// aunque nadie le haya configurado un minimo, porque no se puede vender igual.
// El precio es que un producto recien creado y aun sin surtir tambien aparece,
// que es justamente cuando hay que surtirlo.
function listarBajoMinimo() {
  return getDb().prepare(`
    SELECT * FROM productos
    WHERE activo = 1 AND stock <= stock_min
    ORDER BY (stock - stock_min), nombre
  `).all();
}

function historialStock(productoId) {
  return getDb().prepare(`
    SELECT * FROM auditoria
    WHERE accion = 'stock_movido' AND entidad_id = ?
    ORDER BY fecha DESC
  `).all(productoId).map(fila => ({ ...fila, detalle: JSON.parse(fila.detalle) }));
}

module.exports = {
  crear, listar, listarTodos, obtenerPorId, obtenerPorCodigo,
  editar, desactivar, activar,
  moverStock, ajustarStock, listarBajoMinimo, historialStock,
};
