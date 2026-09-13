const crypto = require('crypto');
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
      INSERT INTO productos (nombre, categoria, p_venta, p_costo, stock, stock_min, codigo_barras, fuera_de_caja, activo)
      VALUES (@nombre, @categoria, @p_venta, @p_costo, @stock, @stock_min, @codigo_barras, @fuera_de_caja, 1)
    `).run({
      nombre: producto.nombre,
      categoria: producto.categoria || null,
      p_venta: producto.p_venta,
      p_costo: producto.p_costo || 0,
      stock: producto.stock || 0,
      stock_min: producto.stock_min || 0,
      codigo_barras: normalizarCodigo(producto.codigo_barras),
      fuera_de_caja: producto.fuera_de_caja ? 1 : 0,
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

// Como obtenerPorCodigo pero SIN filtrar los desactivados. Lo usa el lector de
// codigos: si escanean un producto desactivado hay que decir "esta desactivado",
// no "no esta registrado" -- son dos arreglos distintos, y el segundo llevaria a
// alguien a crear un duplicado que chocaria con el codigo del primero.
function buscarPorCodigo(codigo) {
  const normalizado = normalizarCodigo(codigo);
  if (!normalizado) return undefined;
  return getDb().prepare(`SELECT * FROM productos WHERE codigo_barras = ?`).get(normalizado);
}

// El stock no se toca aqui: se mueve solo por moverLote o por una venta, que
// dejan rastro. Editarlo junto al precio lo volveria un campo mas del formulario
// y se perderia el porque de cada cambio.
function editar(id, cambios) {
  try {
    getDb().prepare(`
      UPDATE productos SET
        nombre = @nombre, categoria = @categoria,
        p_venta = @p_venta, p_costo = @p_costo,
        stock_min = @stock_min, codigo_barras = @codigo_barras,
        fuera_de_caja = @fuera_de_caja
      WHERE id = @id
    `).run({
      id,
      nombre: cambios.nombre,
      categoria: cambios.categoria || null,
      p_venta: cambios.p_venta,
      p_costo: cambios.p_costo || 0,
      stock_min: cambios.stock_min || 0,
      codigo_barras: normalizarCodigo(cambios.codigo_barras),
      fuera_de_caja: cambios.fuera_de_caja ? 1 : 0,
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
function moverStock({ productoId, delta, motivo, usuarioId, entidad = 'productos', detalleExtra = null }) {
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
      JSON.stringify({ delta, motivo: motivo || null, stockAnterior: producto.stock, stockNuevo: nuevo, ...(detalleExtra || {}) })
    );

    return { ok: true, stockAnterior: producto.stock, stockNuevo: nuevo };
  });
  return tx();
}

// Motivos de una SALIDA de mercancia: lo que sale sin venderse. Obligatorio y de
// esta lista (decision de Andrey del 12-sep-2026): una salida sin venta es plata
// que se va, y con categorias fijas despues se puede sumar cuanto se pierde por
// vencimientos. 'Otro' exige escribir que fue; si no, acabaria siendo el cajon
// donde cae todo.
const MOTIVOS_SALIDA = ['Vencido', 'Dañado', 'Consumo interno', 'Devolución a proveedor', 'Otro'];

// Tope por linea. Ningun gimnasio recibe cien mil unidades de un producto de una
// vez; lo que si pasa es teclear un codigo de barras en la casilla de cantidad.
// Cuando la probamos sin la proteccion del lector, una entrada llego a sumar
// 37.700.304.572.069 unidades: el inventario quedaba arruinado de un golpe, y
// SQLite ya ni lo guardaba como entero.
const MAX_CANTIDAD_POR_LINEA = 99999;

class Abortar extends Error {
  constructor(resultado) { super('abortar_lote'); this.resultado = resultado; }
}

// Entrada o salida de mercancia de VARIOS productos a la vez, como se confirma
// despues de escanearlos. Es el unico camino para mover stock a mano: tambien el
// "Ajustar stock" de un solo producto pasa por aqui, para que la regla del
// motivo no tenga una puerta trasera.
//
// Todo o nada. Si a mitad de una salida un producto no tiene existencias
// suficientes, no se aplica ninguno: una recepcion a medias es peor que ninguna,
// porque el inventario queda en un estado que nadie ha revisado.
function moverLote({ tipo, items, motivo = null, nota = null, usuarioId }) {
  if (tipo !== 'entrada' && tipo !== 'salida') return { ok: false, motivo: 'tipo_invalido' };
  if (!Array.isArray(items) || items.length === 0) return { ok: false, motivo: 'sin_productos' };

  const notaLimpia = (nota || '').trim() || null;
  if (tipo === 'salida') {
    if (!MOTIVOS_SALIDA.includes(motivo)) return { ok: false, motivo: 'motivo_requerido' };
    if (motivo === 'Otro' && !notaLimpia) return { ok: false, motivo: 'nota_requerida' };
  }

  // El mismo producto escaneado en dos lineas se suma en una: si no, la
  // comprobacion de existencias se haria linea a linea y dejaria pasar una
  // salida mayor que el stock.
  const porProducto = new Map();
  for (const it of items) {
    const cantidad = Number(it && it.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD_POR_LINEA) {
      return { ok: false, motivo: 'cantidad_invalida', productoId: it && it.productoId };
    }
    porProducto.set(it.productoId, (porProducto.get(it.productoId) || 0) + cantidad);
  }

  const db = getDb();
  const lote = crypto.randomUUID();
  const textoMotivo = tipo === 'entrada'
    ? (notaLimpia || 'Entrada de mercancía')
    : motivo + (notaLimpia ? ': ' + notaLimpia : '');

  try {
    const movimientos = db.transaction(() => {
      const hechos = [];
      for (const [productoId, cantidad] of porProducto) {
        const p = db.prepare('SELECT id, nombre, activo FROM productos WHERE id = ?').get(productoId);
        if (!p) throw new Abortar({ ok: false, motivo: 'producto_no_existe', productoId });
        if (!p.activo) throw new Abortar({ ok: false, motivo: 'producto_inactivo', productoId, nombre: p.nombre });

        const r = moverStock({
          productoId,
          delta: tipo === 'entrada' ? cantidad : -cantidad,
          motivo: textoMotivo,
          usuarioId,
          detalleExtra: { tipo, categoria: tipo === 'salida' ? motivo : null, nota: notaLimpia, lote },
        });
        if (!r.ok) throw new Abortar({ ...r, productoId, nombre: p.nombre });
        hechos.push({ productoId, nombre: p.nombre, cantidad, stockAnterior: r.stockAnterior, stockNuevo: r.stockNuevo });
      }
      return hechos;
    })();

    return {
      ok: true, lote, movimientos,
      unidades: movimientos.reduce((s, m) => s + m.cantidad, 0),
    };
  } catch (e) {
    if (e instanceof Abortar) return e.resultado;
    throw e;
  }
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

// Desempate por id: dos movimientos en el mismo milisegundo (una entrada de
// varios productos, o dos pulsaciones seguidas) tienen la misma fecha, y sin el
// id el orden entre ellos salia al azar.
function historialStock(productoId) {
  return getDb().prepare(`
    SELECT * FROM auditoria
    WHERE accion = 'stock_movido' AND entidad_id = ?
    ORDER BY fecha DESC, id DESC
  `).all(productoId).map(fila => ({ ...fila, detalle: JSON.parse(fila.detalle) }));
}

module.exports = {
  crear, listar, listarTodos, obtenerPorId, obtenerPorCodigo, buscarPorCodigo,
  editar, desactivar, activar,
  moverStock, moverLote, MOTIVOS_SALIDA, MAX_CANTIDAD_POR_LINEA, listarBajoMinimo, historialStock,
};
