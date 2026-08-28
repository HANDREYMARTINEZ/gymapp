import { useState, useEffect, useRef } from 'react';

const pesos = (n) => '$' + (n || 0).toLocaleString('es-CO');

const MOTIVOS = {
  sin_caja_abierta: 'No hay una caja abierta. Una venta en efectivo entra al cajón, así que abre la caja primero (o cobra con otro medio).',
  stock_insuficiente: 'No hay existencias suficientes.',
  producto_inactivo: 'Ese producto está inactivo.',
  producto_no_existe: 'Ese producto ya no existe.',
  sin_items: 'Agrega al menos un producto.',
  medio_pago_invalido: 'Elige un medio de pago válido.',
  cantidad_invalida: 'Alguna cantidad no es válida.',
};

function mensajeDe(r) {
  const base = MOTIVOS[r.motivo] || 'No se pudo completar la venta: ' + r.motivo;
  return r.nombre ? base + ' (' + r.nombre + (r.stockActual != null ? ', quedan ' + r.stockActual : '') + ')' : base;
}

export default function POS({ usuarioActual }) {
  const [productos, setProductos] = useState([]);
  const [carrito, setCarrito] = useState([]);
  const [medios, setMedios] = useState([]);
  const [metodoPago, setMetodoPago] = useState('Efectivo');
  const [busqueda, setBusqueda] = useState('');
  const [cajaAbierta, setCajaAbierta] = useState(null);
  const [error, setError] = useState('');
  const [ultimaVenta, setUltimaVenta] = useState(null);
  const [cobrando, setCobrando] = useState(false);
  const buscador = useRef(null);

  async function cargar() {
    setProductos(await window.api.productos.listar());
    setCajaAbierta(await window.api.caja.sesionAbierta() || null);
  }

  useEffect(() => {
    cargar();
    window.api.ventas.mediosPago().then(setMedios);
  }, []);

  const texto = busqueda.trim().toLowerCase();
  const visibles = texto
    ? productos.filter(p =>
        p.nombre.toLowerCase().includes(texto)
        || (p.categoria || '').toLowerCase().includes(texto)
        || (p.codigo_barras || '').includes(texto))
    : productos;

  function agregar(producto) {
    setError('');
    setUltimaVenta(null);
    setCarrito(prev => {
      const yaEsta = prev.find(l => l.productoId === producto.id);
      if (yaEsta) {
        return prev.map(l => l.productoId === producto.id ? { ...l, cantidad: l.cantidad + 1 } : l);
      }
      return [...prev, {
        productoId: producto.id, nombre: producto.nombre,
        pUnitario: producto.p_venta, cantidad: 1, stock: producto.stock,
      }];
    });
  }

  function cambiarCantidad(productoId, cantidad) {
    setError('');
    if (cantidad <= 0) {
      setCarrito(prev => prev.filter(l => l.productoId !== productoId));
      return;
    }
    setCarrito(prev => prev.map(l => l.productoId === productoId ? { ...l, cantidad } : l));
  }

  // El lector de códigos de barras escribe el código y manda Enter. Buscar por
  // código exacto primero permite que el mismo campo sirva para teclear a mano
  // y para escanear, sin un modo aparte.
  async function porEnter() {
    const texto = busqueda.trim();
    if (!texto) return;

    const porCodigo = await window.api.productos.obtenerPorCodigo(texto);
    if (porCodigo) {
      agregar(porCodigo);
      setBusqueda('');
      return;
    }
    const coincidencias = visibles;
    if (coincidencias.length === 1) {
      agregar(coincidencias[0]);
      setBusqueda('');
    }
  }

  async function cobrar() {
    if (carrito.length === 0) { setError('Agrega al menos un producto.'); return; }

    setCobrando(true);
    const r = await window.api.ventas.registrar({
      items: carrito.map(l => ({ productoId: l.productoId, cantidad: l.cantidad })),
      metodoPago,
      usuarioId: usuarioActual.id,
    });
    setCobrando(false);

    if (!r.ok) { setError(mensajeDe(r)); return; }

    setUltimaVenta({ ...r, metodoPago });
    setCarrito([]);
    setError('');
    cargar();
    if (buscador.current) buscador.current.focus();
  }

  const total = carrito.reduce((s, l) => s + l.pUnitario * l.cantidad, 0);
  const necesitaCaja = metodoPago === 'Efectivo' && !cajaAbierta;

  return (
    <div>
      <h1>POS</h1>

      {!cajaAbierta && (
        <p style={{ border: '1px solid var(--aviso)', background: 'var(--aviso-fondo)', padding: 10, maxWidth: 720 }}>
          No hay caja abierta. Puedes cobrar con tarjeta o transferencia, pero no
          en efectivo: ábrela desde <b>Caja</b>.
        </p>
      )}

      {ultimaVenta && (
        <p style={{ border: '1px solid var(--exito)', background: 'var(--exito-fondo)', padding: 10, maxWidth: 720 }}>
          Venta <b>#{ultimaVenta.ventaId}</b> registrada por <b>{pesos(ultimaVenta.total)}</b> en {ultimaVenta.metodoPago}.
        </p>
      )}

      <div style={{ display: 'flex', gap: 30, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <input ref={buscador} autoFocus
                 placeholder="Buscar o escanear código, Enter para agregar"
                 value={busqueda}
                 onChange={e => setBusqueda(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') porEnter(); }}
                 style={{ width: '100%', padding: 6 }} />

          <table style={{ marginTop: 12, borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--borde-fuerte)' }}>
                <th>Producto</th><th style={{ textAlign: 'right' }}>Precio</th>
                <th style={{ textAlign: 'right' }}>Stock</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                  <td>{p.nombre}</td>
                  <td style={{ textAlign: 'right' }}>{pesos(p.p_venta)}</td>
                  <td style={{ textAlign: 'right', color: p.stock <= 0 ? 'var(--error)' : 'inherit' }}>{p.stock}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => agregar(p)} disabled={p.stock <= 0}>Agregar</button>
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && (
                <tr><td colSpan={4} style={{ paddingTop: 12, color: 'var(--texto-tenue)' }}>
                  {productos.length === 0 ? 'No hay productos activos. Créalos en Inventario.' : 'Nada coincide.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ width: 380, border: '1px solid var(--borde-fuerte)', padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Venta actual</h3>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {carrito.map(l => (
                <tr key={l.productoId} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                  <td>
                    {l.nombre}
                    <br /><small style={{ color: 'var(--texto-tenue)' }}>{pesos(l.pUnitario)} c/u</small>
                  </td>
                  <td style={{ width: 70 }}>
                    <input type="number" value={l.cantidad} min={0}
                           onChange={e => cambiarCantidad(l.productoId, parseInt(e.target.value, 10) || 0)}
                           style={{ width: 55 }} />
                  </td>
                  <td style={{ textAlign: 'right' }}>{pesos(l.pUnitario * l.cantidad)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => cambiarCantidad(l.productoId, 0)}>×</button>
                  </td>
                </tr>
              ))}
              {carrito.length === 0 && (
                <tr><td style={{ color: 'var(--texto-tenue)', paddingBottom: 8 }}>Sin productos todavía.</td></tr>
              )}
            </tbody>
          </table>

          <p style={{ fontSize: 22, textAlign: 'right', marginBottom: 6 }}><b>{pesos(total)}</b></p>

          <select value={metodoPago} onChange={e => { setMetodoPago(e.target.value); setError(''); }}
                  style={{ width: '100%', padding: 4 }}>
            {medios.map(m => <option key={m}>{m}</option>)}
          </select>

          {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

          <button onClick={cobrar} disabled={cobrando || carrito.length === 0 || necesitaCaja}
                  style={{ marginTop: 10, width: '100%', padding: 10, fontSize: 16 }}>
            {cobrando ? 'Cobrando...' : 'Cobrar ' + pesos(total)}
          </button>
          {necesitaCaja && (
            <small style={{ color: 'var(--error)' }}>Abre la caja para cobrar en efectivo.</small>
          )}
          {carrito.length > 0 && (
            <button onClick={() => { setCarrito([]); setError(''); }} style={{ marginTop: 6, width: '100%' }}>
              Vaciar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
