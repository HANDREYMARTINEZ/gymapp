import { useState, useEffect } from 'react';
import ProductoForm from './ProductoForm';
import MovimientoMercancia from './MovimientoMercancia';
import { useCodigoEscaneado } from '../lector/lector';
import Miniatura from '../components/Miniatura';

const pesos = (n) => '$' + (n || 0).toLocaleString('es-CO');

// El ajuste de un solo producto. Pasa por el mismo camino que la Entrada y la
// Salida de mercancia (productos.moverLote), asi que la salida exige el mismo
// motivo de la lista: si no, este boton seria la puerta trasera de esa regla.
function AjusteStock({ producto, usuarioActual, onListo, onCancelar }) {
  const [cantidad, setCantidad] = useState('');
  const [sentido, setSentido] = useState('entrada');
  const [motivos, setMotivos] = useState([]);
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { window.api.productos.motivosSalida().then(setMotivos); }, []);

  async function aplicar() {
    const n = parseInt(cantidad, 10);
    if (!n || n <= 0) { setError('Escribe una cantidad mayor que cero.'); return; }
    if (sentido === 'salida' && !motivo) { setError('Elige el motivo de la salida.'); return; }
    if (sentido === 'salida' && motivo === 'Otro' && !nota.trim()) { setError('Con "Otro" hay que escribir qué pasó.'); return; }

    setGuardando(true);
    const r = await window.api.productos.moverLote({
      tipo: sentido,
      items: [{ productoId: producto.id, cantidad: n }],
      motivo: sentido === 'salida' ? motivo : null,
      nota: nota.trim() || null,
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
    <div style={{ border: '1px solid var(--borde-fuerte)', padding: 16, marginTop: 16, maxWidth: 480 }}>
      <h3 style={{ marginTop: 0 }}>Ajustar stock — {producto.nombre}</h3>
      <p style={{ color: 'var(--texto-suave)' }}>En existencia ahora: <b>{producto.stock}</b></p>

      <select value={sentido} onChange={e => { setSentido(e.target.value); setError(''); }}>
        <option value="entrada">Entrada (compra, devolución)</option>
        <option value="salida">Salida sin venta (vencido, dañado, consumo)</option>
      </select>
      <input type="number" placeholder="Cantidad" value={cantidad}
             onChange={e => { setCantidad(e.target.value); setError(''); }}
             style={{ marginLeft: 8, width: 100 }} />

      {sentido === 'salida' && (
        <div style={{ marginTop: 8 }}>
          <select value={motivo} onChange={e => { setMotivo(e.target.value); setError(''); }}>
            <option value="">Motivo * (elige uno)</option>
            {motivos.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}
      <input placeholder={sentido === 'salida' ? (motivo === 'Otro' ? 'Qué pasó *' : 'Detalle (opcional)') : 'Nota: proveedor, factura… (opcional)'}
             value={nota} onChange={e => { setNota(e.target.value); setError(''); }}
             style={{ marginTop: 8, width: '100%' }} />

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <button onClick={aplicar} disabled={guardando} style={{ marginTop: 8 }}>
        {guardando ? 'Aplicando...' : 'Aplicar ajuste'}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}

export default function Inventario({ usuarioActual }) {
  const [productos, setProductos] = useState([]);
  const [imagenes, setImagenes] = useState({});
  const [modo, setModo] = useState('lista');
  const [productoEditando, setProductoEditando] = useState(null);
  const [ajustando, setAjustando] = useState(null);
  const [porDesactivar, setPorDesactivar] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false);
  const [avisoLector, setAvisoLector] = useState(null);
  const [codigoNuevo, setCodigoNuevo] = useState(null);

  async function cargar() {
    const lista = await window.api.productos.listarTodos();
    setProductos(lista);
    setImagenes(await window.api.imagenes.obtenerVarias('producto', lista.map(p => p.id)));
  }

  useEffect(() => { cargar(); }, []);

  // Escanear en la lista busca el producto. Si el codigo no existe se ofrece
  // crearlo con el codigo ya puesto. Solo en la lista: la entrada, la salida y el
  // formulario escuchan los suyos.
  useCodigoEscaneado(async (codigo) => {
    const p = await window.api.productos.buscarPorCodigo(codigo);
    if (p) {
      setBusqueda(codigo);
      setSoloBajoMinimo(false);
      setAvisoLector(null);
    } else {
      setAvisoLector({ codigo });
    }
  }, modo === 'lista');

  function volverALista() {
    setModo('lista');
    setProductoEditando(null);
    setAjustando(null);
    setCodigoNuevo(null);
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
          codigoInicial={modo === 'nuevo' ? codigoNuevo : null}
          onGuardado={volverALista}
          onCancelar={volverALista}
        />
      </div>
    );
  }

  if (modo === 'entrada' || modo === 'salida') {
    return (
      <div>
        <h1>Inventario</h1>
        <MovimientoMercancia tipo={modo} usuarioActual={usuarioActual} onTerminar={volverALista} />
      </div>
    );
  }

  return (
    <div>
      <h1>Inventario</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => { setAjustando(null); setModo('entrada'); }}>Entrada de mercancía</button>
        <button onClick={() => { setAjustando(null); setModo('salida'); }}>Salida de mercancía</button>
      </div>

      {avisoLector && (
        <div style={{ padding: '8px 12px', marginBottom: 12, maxWidth: 640, border: '1px solid var(--aviso)',
                      background: 'var(--aviso-fondo)', borderRadius: 'var(--radio)' }}>
          El código <b>{avisoLector.codigo}</b> no está registrado.
          <button style={{ marginLeft: 8 }} onClick={() => { setCodigoNuevo(avisoLector.codigo); setAvisoLector(null); setModo('nuevo'); }}>
            Crear producto con este código
          </button>
          <button style={{ marginLeft: 4 }} onClick={() => setAvisoLector(null)}>Cerrar</button>
        </div>
      )}

      <button onClick={() => { setCodigoNuevo(null); setModo('nuevo'); }}>+ Nuevo producto</button>
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
        <div style={{ border: '2px solid var(--error)', padding: 16, marginTop: 16, maxWidth: 480 }}>
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
          <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--borde-fuerte)' }}>
            <th></th><th>Producto</th><th>Categoría</th><th>Venta</th><th>Costo</th>
            <th>Stock</th><th>Mín.</th><th>Estado</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visibles.map(p => {
            const bajo = p.activo && p.stock <= p.stock_min;
            return (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--borde-suave)', opacity: p.activo ? 1 : 0.5 }}>
                <td style={{ width: 52 }}>
                  <Miniatura url={imagenes[p.id]} nombre={p.nombre} lado={40} />
                </td>
                <td>
                  {p.nombre}
                  {p.codigo_barras && <><br /><small style={{ color: 'var(--texto-tenue)' }}>{p.codigo_barras}</small></>}
                </td>
                <td>
                  {p.categoria || '—'}
                  {p.fuera_de_caja ? (
                    <><br /><small style={{ color: 'var(--aviso)' }}>Fuera de caja</small></>
                  ) : null}
                </td>
                <td>{pesos(p.p_venta)}</td>
                <td>{pesos(p.p_costo)}</td>
                <td style={{ fontWeight: bajo ? 'bold' : 'normal', color: bajo ? 'var(--error)' : 'inherit' }}>
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
            <tr><td colSpan={9} style={{ paddingTop: 12, color: 'var(--texto-tenue)' }}>
              {productos.length === 0 ? 'Todavía no hay productos.' : 'Ningún producto coincide con el filtro.'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
