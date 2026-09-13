import { useState, useEffect } from 'react';
import ProductoForm from './ProductoForm';
import { useCodigoEscaneado } from '../lector/lector';

// Entrada o salida de mercancia escaneando los productos.
//
// Se arma una LISTA y se confirma una vez (decision de Andrey del 12-sep-2026),
// en vez de mover el stock en cada pitido: un doble escaneo o un producto
// equivocado no deben cambiar el inventario sin que nadie lo vea, y una caja de
// 24 se escanea una vez y se escribe 24.
//
// Entrada: solo cantidades, el costo sigue en la ficha del producto.
// Salida: lo que sale SIN venderse. El motivo es obligatorio y de una lista, y lo
// exige el backend (productos.moverLote), no solo esta pantalla.

const TEXTOS_FALLO = {
  stock_insuficiente: (r) => '«' + r.nombre + '» ya no tiene suficientes: quedan ' + r.stockActual + '. Puede que se haya vendido algo mientras tanto.',
  producto_inactivo: (r) => '«' + r.nombre + '» está desactivado.',
  producto_no_existe: () => 'Uno de los productos ya no existe.',
  motivo_requerido: () => 'Elige el motivo de la salida.',
  nota_requerida: () => 'Con "Otro" hay que escribir qué pasó.',
  cantidad_invalida: () => 'Todas las cantidades tienen que ser números enteros mayores que cero.',
  sin_productos: () => 'La lista está vacía.',
};

export default function MovimientoMercancia({ tipo, usuarioActual, onTerminar }) {
  const esSalida = tipo === 'salida';
  const [productos, setProductos] = useState([]);
  const [motivos, setMotivos] = useState([]);
  const [lineas, setLineas] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [creandoCodigo, setCreandoCodigo] = useState(null);

  async function cargarProductos() {
    setProductos(await window.api.productos.listar());
  }

  useEffect(() => {
    cargarProductos();
    if (esSalida) window.api.productos.motivosSalida().then(setMotivos);
  }, []);

  function sumar(p, cuanto = 1) {
    setError('');
    setConfirmando(false);
    setLineas(prev => {
      const esta = prev.find(l => l.productoId === p.id);
      if (esta) {
        const actual = parseInt(esta.cantidad, 10) || 0;
        // La que se acaba de escanear sube arriba: es la que se esta mirando.
        return [{ ...esta, cantidad: String(actual + cuanto) }, ...prev.filter(l => l !== esta)];
      }
      return [{ productoId: p.id, nombre: p.nombre, stock: p.stock, codigo: p.codigo_barras, cantidad: String(cuanto) }, ...prev];
    });
  }

  // Mientras se confirma, o con el formulario de producto nuevo abierto (que
  // escucha el suyo), un escaneo no debe tocar la lista.
  useCodigoEscaneado(async (codigo) => {
    const p = await window.api.productos.buscarPorCodigo(codigo);
    if (!p) { setAviso({ tipo: 'desconocido', codigo }); return; }
    if (!p.activo) {
      setAviso({ tipo: 'error', texto: '«' + p.nombre + '» está desactivado. Actívalo en la lista del inventario antes de moverle stock.' });
      return;
    }
    sumar(p);
    setAviso({ tipo: 'ok', texto: '+1  ' + p.nombre });
  }, !confirmando && !resultado && !creandoCodigo);

  const texto = busqueda.trim().toLowerCase();
  const coincidencias = texto
    ? productos.filter(p => p.nombre.toLowerCase().includes(texto) || (p.codigo_barras || '').includes(texto)).slice(0, 8)
    : [];

  function cambiarCantidad(productoId, valor) {
    setError('');
    setConfirmando(false);
    setLineas(prev => prev.map(l => l.productoId === productoId ? { ...l, cantidad: valor.replace(/\D/g, '') } : l));
  }

  function quitar(productoId) {
    setConfirmando(false);
    setLineas(prev => prev.filter(l => l.productoId !== productoId));
  }

  const cantidadDe = (l) => parseInt(l.cantidad, 10) || 0;
  const unidades = lineas.reduce((s, l) => s + cantidadDe(l), 0);
  const lineaMala = (l) => cantidadDe(l) <= 0 || (esSalida && cantidadDe(l) > l.stock);

  function revisar() {
    if (lineas.length === 0) { setError('Escanea o agrega al menos un producto.'); return; }
    if (lineas.some(l => cantidadDe(l) <= 0)) { setError('Hay productos con cantidad vacía o en cero.'); return; }
    if (esSalida && lineas.some(l => cantidadDe(l) > l.stock)) { setError('Hay productos con más cantidad de la que hay en existencia.'); return; }
    if (esSalida && !motivo) { setError('Elige el motivo de la salida.'); return; }
    if (esSalida && motivo === 'Otro' && !nota.trim()) { setError('Con "Otro" hay que escribir qué pasó.'); return; }
    setError('');
    setConfirmando(true);
  }

  async function aplicar() {
    setGuardando(true);
    const r = await window.api.productos.moverLote({
      tipo,
      items: lineas.map(l => ({ productoId: l.productoId, cantidad: cantidadDe(l) })),
      motivo: esSalida ? motivo : null,
      nota: nota.trim() || null,
      usuarioId: usuarioActual.id,
    });
    setGuardando(false);
    setConfirmando(false);
    if (!r.ok) {
      setError((TEXTOS_FALLO[r.motivo] || (() => 'No se pudo aplicar: ' + r.motivo))(r));
      // Las existencias pudieron cambiar (una venta mientras tanto): se refrescan.
      const frescos = await window.api.productos.listar();
      setProductos(frescos);
      setLineas(prev => prev.map(l => {
        const f = frescos.find(p => p.id === l.productoId);
        return f ? { ...l, stock: f.stock } : l;
      }));
      return;
    }
    setResultado(r);
  }

  function otra() {
    setLineas([]); setMotivo(''); setNota(''); setAviso(null); setError('');
    setResultado(null); setBusqueda('');
    cargarProductos();
  }

  // ------------------------------------------------ crear producto escaneado
  if (creandoCodigo) {
    return (
      <div>
        <h2 style={{ marginBottom: 0 }}>Producto nuevo desde la entrada</h2>
        <p style={{ color: 'var(--texto-suave)', marginTop: 4 }}>
          Al guardarlo se añade a la entrada. No tiene stock inicial: lo pone la entrada misma.
        </p>
        <ProductoForm
          codigoInicial={creandoCodigo}
          sinStockInicial
          onGuardado={async (r) => {
            setCreandoCodigo(null);
            await cargarProductos();
            if (r && r.id) {
              const nuevo = await window.api.productos.obtener(r.id);
              if (nuevo) { sumar(nuevo); setAviso({ tipo: 'ok', texto: 'Creado y añadido: ' + nuevo.nombre }); }
            }
          }}
          onCancelar={() => setCreandoCodigo(null)}
        />
      </div>
    );
  }

  // --------------------------------------------------------------- resultado
  if (resultado) {
    return (
      <div style={{ maxWidth: 720 }}>
        <h2>{esSalida ? 'Salida aplicada' : 'Entrada aplicada'}</h2>
        <p style={{ color: 'var(--exito)' }}>
          {esSalida ? 'Se restaron ' : 'Se sumaron '}<b>{resultado.unidades}</b> unidades
          de <b>{resultado.movimientos.length}</b> producto(s).
        </p>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '2px solid var(--borde-fuerte)' }}>
            <th>Producto</th><th>Cantidad</th><th>Antes</th><th>Ahora</th>
          </tr></thead>
          <tbody>
            {resultado.movimientos.map(m => (
              <tr key={m.productoId} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                <td>{m.nombre}</td><td>{esSalida ? '−' : '+'}{m.cantidad}</td>
                <td>{m.stockAnterior}</td><td><b>{m.stockNuevo}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button onClick={otra}>{esSalida ? 'Hacer otra salida' : 'Hacer otra entrada'}</button>
          <button onClick={onTerminar}>Volver al inventario</button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------- lista
  return (
    <div style={{ maxWidth: 820 }}>
      <h2 style={{ marginBottom: 4 }}>{esSalida ? 'Salida de mercancía' : 'Entrada de mercancía'}</h2>
      <p style={{ color: 'var(--texto-suave)', marginTop: 0 }}>
        {esSalida
          ? 'Lo que sale sin venderse: vencido, dañado, consumo interno. Escanea cada producto; cada escaneo suma 1, o escribe la cantidad.'
          : 'Escanea lo que llegó; cada escaneo suma 1, o escribe la cantidad de la caja. Nada cambia hasta que confirmes.'}
      </p>

      {aviso && aviso.tipo === 'ok' && (
        <div style={{ padding: '6px 12px', marginBottom: 10, color: 'var(--exito)', border: '1px solid var(--exito)', borderRadius: 'var(--radio)' }}>
          {'✔'} {aviso.texto}
        </div>
      )}
      {aviso && aviso.tipo === 'error' && (
        <div style={{ padding: '6px 12px', marginBottom: 10, color: 'var(--error)', border: '1px solid var(--error)', borderRadius: 'var(--radio)' }}>
          {aviso.texto}
        </div>
      )}
      {aviso && aviso.tipo === 'desconocido' && (
        <div style={{ padding: '8px 12px', marginBottom: 10, border: '1px solid var(--aviso)', background: 'var(--aviso-fondo)', borderRadius: 'var(--radio)' }}>
          El código <b>{aviso.codigo}</b> no está registrado.
          {esSalida
            ? ' No se le puede sacar stock a un producto que no existe.'
            : <> <button style={{ marginLeft: 8 }} onClick={() => { setCreandoCodigo(aviso.codigo); setAviso(null); }}>
                 Crear producto con este código
               </button></>}
        </div>
      )}

      {/* Muchos productos del gimnasio no traen codigo: se tienen que poder
          anadir igual, por nombre. */}
      <div style={{ position: 'relative', maxWidth: 420, marginBottom: 12 }}>
        <input placeholder="Agregar sin código: busca por nombre"
               value={busqueda} onChange={e => setBusqueda(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter' && coincidencias.length === 1) { sumar(coincidencias[0]); setBusqueda(''); } }}
               style={{ width: '100%' }} />
        {coincidencias.length > 0 && (
          <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: 'var(--fondo)', border: '1px solid var(--borde-fuerte)', borderRadius: 'var(--radio)' }}>
            {coincidencias.map(p => (
              <div key={p.id} onClick={() => { sumar(p); setBusqueda(''); }}
                   style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid var(--borde-suave)' }}>
                {p.nombre} <small style={{ color: 'var(--texto-tenue)' }}>— hay {p.stock}</small>
              </div>
            ))}
          </div>
        )}
      </div>

      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr style={{ textAlign: 'left', borderBottom: '2px solid var(--borde-fuerte)' }}>
          <th>Producto</th><th>Hay</th><th>Cantidad</th><th>Quedará</th><th></th>
        </tr></thead>
        <tbody>
          {lineas.map(l => {
            const mala = lineaMala(l);
            const queda = esSalida ? l.stock - cantidadDe(l) : l.stock + cantidadDe(l);
            return (
              <tr key={l.productoId} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                <td>{l.nombre}{l.codigo && <><br /><small style={{ color: 'var(--texto-tenue)' }}>{l.codigo}</small></>}</td>
                <td>{l.stock}</td>
                <td>
                  <input value={l.cantidad} inputMode="numeric" maxLength={5} onChange={e => cambiarCantidad(l.productoId, e.target.value)}
                         style={{ width: 70, textAlign: 'center', borderColor: mala ? 'var(--error)' : undefined }} />
                  {esSalida && cantidadDe(l) > l.stock && (
                    <div style={{ fontSize: 12, color: 'var(--error)' }}>sólo hay {l.stock}</div>
                  )}
                </td>
                <td style={{ fontWeight: 'bold', color: mala ? 'var(--error)' : 'inherit' }}>{queda}</td>
                <td><button onClick={() => quitar(l.productoId)}>Quitar</button></td>
              </tr>
            );
          })}
          {lineas.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 16, color: 'var(--texto-tenue)' }}>
              Todavía no hay productos. Escanea el primero.
            </td></tr>
          )}
        </tbody>
      </table>

      <div style={{ marginTop: 14, maxWidth: 520 }}>
        {esSalida && (
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'inline-block', width: 90 }}>Motivo *</label>
            <select value={motivo} onChange={e => { setMotivo(e.target.value); setError(''); setConfirmando(false); }}>
              <option value="">(elige uno)</option>
              {motivos.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}
        <div>
          <label style={{ display: 'inline-block', width: 90 }}>
            {esSalida ? (motivo === 'Otro' ? 'Qué pasó *' : 'Nota') : 'Nota'}
          </label>
          <input value={nota} onChange={e => { setNota(e.target.value); setError(''); }}
                 placeholder={esSalida ? 'Detalle (opcional salvo con "Otro")' : 'Proveedor, factura… (opcional)'}
                 style={{ width: 400 }} />
        </div>
      </div>

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <div style={{ marginTop: 14 }}>
        <b>{lineas.length}</b> producto(s), <b>{unidades}</b> unidades.
      </div>

      {!confirmando ? (
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button onClick={revisar} disabled={guardando}>
            {esSalida ? 'Revisar salida' : 'Revisar entrada'}
          </button>
          {!descartando ? (
            <button onClick={() => (lineas.length ? setDescartando(true) : onTerminar())}>Cancelar</button>
          ) : (
            <>
              <span style={{ alignSelf: 'center', color: 'var(--aviso)' }}>¿Descartar la lista?</span>
              <button onClick={onTerminar}>Sí, descartar</button>
              <button onClick={() => setDescartando(false)}>No</button>
            </>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 10, padding: 12, maxWidth: 560, border: '1px solid var(--aviso)', background: 'var(--aviso-fondo)', borderRadius: 'var(--radio)' }}>
          {esSalida
            ? <>Se van a <b>restar {unidades} unidades</b> de {lineas.length} producto(s), motivo <b>{motivo}</b>.</>
            : <>Se van a <b>sumar {unidades} unidades</b> a {lineas.length} producto(s).</>}
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button onClick={aplicar} disabled={guardando}>
              {guardando ? 'Aplicando...' : (esSalida ? 'Sí, aplicar salida' : 'Sí, aplicar entrada')}
            </button>
            <button onClick={() => setConfirmando(false)} disabled={guardando}>Volver a la lista</button>
          </div>
        </div>
      )}
    </div>
  );
}
