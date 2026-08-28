import { useState, useEffect } from 'react';
import ProductoForm from './ProductoForm';

const pesos = (n) => '$' + (n || 0).toLocaleString('es-CO');

function AjusteStock({ producto, usuarioActual, onListo, onCancelar }) {
  const [cantidad, setCantidad] = useState('');
  const [sentido, setSentido] = useState('entrada');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function aplicar() {
    const n = parseInt(cantidad, 10);
    if (!n || n <= 0) { setError('Escribe una cantidad mayor que cero.'); return; }

    setGuardando(true);
    const r = await window.api.productos.ajustarStock({
      productoId: producto.id,
      delta: sentido === 'entrada' ? n : -n,
      motivo: motivo.trim() || null,
      usuarioId: usuarioActual.id,
    });
    setGuardando(false);

    if (!r.ok) {
      setError(r.motivo === 'stock_insuficiente'
        ? 'No se puede: solo hay ' + r.stockActual + ' en existencia.'
        : 'No se pudo ajustar: ' + r.motivo);
      return;
    }
    onListo();
  }

  return (
    <div style={{ border: '1px solid #333', padding: 16, marginTop: 16, maxWidth: 480 }}>
      <h3 style={{ marginTop: 0 }}>Ajustar stock — {producto.nombre}</h3>
      <p style={{ color: '#555' }}>En existencia ahora: <b>{producto.stock}</b></p>

      <select value={sentido} onChange={e => { setSentido(e.target.value); setError(''); }}>
        <option value="entrada">Entrada (compra, devolución)</option>
        <option value="salida">Salida (merma, consumo interno)</option>
      </select>
      <input type="number" placeholder="Cantidad" value={cantidad}
             onChange={e => { setCantidad(e.target.value); setError(''); }}
             style={{ marginLeft: 8, width: 100 }} />
      <br /><input placeholder="Motivo (recomendado)" value={motivo}
                   onChange={e => setMotivo(e.target.value)}
                   style={{ marginTop: 8, width: '100%' }} />

      {error && <p style={{ color: 'darkred' }}>{error}</p>}

      <button onClick={aplicar} disabled={guardando} style={{ marginTop: 8 }}>
        {guardando ? 'Aplicando...' : 'Aplicar ajuste'}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}

export default function Inventario({ usuarioActual }) {
  const [productos, setProductos] = useState([]);
  const [modo, setModo] = useState('lista');
  const [productoEditando, setProductoEditando] = useState(null);
  const [ajustando, setAjustando] = useState(null);
  const [porDesactivar, setPorDesactivar] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false);

  async function cargar() {
    setProductos(await window.api.productos.listarTodos());
  }

  useEffect(() => { cargar(); }, []);

  function volverALista() {
    setModo('lista');
    setProductoEditando(null);
    setAjustando(null);
    cargar();
  }

  async function confirmarDesactivar() {
    await window.api.productos.desactivar(porDesactivar.id);
    setPorDesactivar(null);
    cargar();
  }

  const texto = busqueda.trim().toLowerCase();
  const visibles = productos.filter(p => {
    if (soloBajoMinimo && !(p.activo && p.stock <= p.stock_min)) return false;
    if (!texto) return true;
    return p.nombre.toLowerCase().includes(texto)
      || (p.categoria || '').toLowerCase().includes(texto)
      || (p.codigo_barras || '').includes(texto);
  });

  const bajoMinimo = productos.filter(p => p.activo && p.stock <= p.stock_min).length;

  if (modo === 'nuevo' || modo === 'editar') {
    return (
      <div>
        <h1>Inventario</h1>
        <ProductoForm
          productoExistente={modo === 'editar' ? productoEditando : null}
          onGuardado={volverALista}
          onCancelar={volverALista}
        />
      </div>
    );
  }

  return (
    <div>
      <h1>Inventario</h1>

      <button onClick={() => setModo('nuevo')}>+ Nuevo producto</button>
      <input placeholder="Buscar por nombre, categoría o código"
             value={busqueda} onChange={e => setBusqueda(e.target.value)}
             style={{ marginLeft: 12, width: 300 }} />
      <label style={{ marginLeft: 12 }}>
        <input type="checkbox" checked={soloBajoMinimo} onChange={e => setSoloBajoMinimo(e.target.checked)} />
        {' '}Solo bajo mínimo{bajoMinimo > 0 ? ' (' + bajoMinimo + ')' : ''}
      </label>

      {ajustando && (
        <AjusteStock producto={ajustando} usuarioActual={usuarioActual}
                     onListo={volverALista} onCancelar={() => setAjustando(null)} />
      )}

      {porDesactivar && (
        <div style={{ border: '2px solid darkred', padding: 16, marginTop: 16, maxWidth: 480 }}>
          <p style={{ marginTop: 0 }}>
            ¿Desactivar <b>{porDesactivar.nombre}</b>? Dejará de aparecer en el POS.
            Su historial y su stock se conservan, y puedes reactivarlo cuando quieras.
          </p>
          <button onClick={confirmarDesactivar}>Sí, desactivar</button>
          <button onClick={() => setPorDesactivar(null)} style={{ marginLeft: 8 }}>Cancelar</button>
        </div>
      )}

      <table style={{ marginTop: 20, borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Producto</th><th>Categoría</th><th>Venta</th><th>Costo</th>
            <th>Stock</th><th>Mín.</th><th>Estado</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visibles.map(p => {
            const bajo = p.activo && p.stock <= p.stock_min;
            return (
              <tr key={p.id} style={{ borderBottom: '1px solid #eee', opacity: p.activo ? 1 : 0.5 }}>
                <td>
                  {p.nombre}
                  {p.codigo_barras && <><br /><small style={{ color: '#888' }}>{p.codigo_barras}</small></>}
                </td>
                <td>{p.categoria || '—'}</td>
                <td>{pesos(p.p_venta)}</td>
                <td>{pesos(p.p_costo)}</td>
                <td style={{ fontWeight: bajo ? 'bold' : 'normal', color: bajo ? 'darkred' : 'inherit' }}>
                  {p.stock}{bajo ? ' ⚠' : ''}
                </td>
                <td>{p.stock_min}</td>
                <td>{p.activo ? 'Activo' : 'Inactivo'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button onClick={() => { setProductoEditando(p); setModo('editar'); }}>Editar</button>
                  <button onClick={() => { setAjustando(p); setPorDesactivar(null); }} style={{ marginLeft: 4 }}>Stock</button>
                  {p.activo
                    ? <button onClick={() => { setPorDesactivar(p); setAjustando(null); }} style={{ marginLeft: 4 }}>Desactivar</button>
                    : <button onClick={async () => { await window.api.productos.activar(p.id); cargar(); }} style={{ marginLeft: 4 }}>Activar</button>}
                </td>
              </tr>
            );
          })}
          {visibles.length === 0 && (
            <tr><td colSpan={8} style={{ paddingTop: 12, color: '#777' }}>
              {productos.length === 0 ? 'Todavía no hay productos.' : 'Ningún producto coincide con el filtro.'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
