import { useState, useEffect } from 'react';
import SelectorImagen from '../components/SelectorImagen';

export default function ProductoForm({ productoExistente, onGuardado, onCancelar }) {
  const [form, setForm] = useState({
    nombre: '', categoria: '', p_venta: '', p_costo: '',
    stock: '', stock_min: '', codigo_barras: '', fuera_de_caja: false,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  // Un producto nuevo no tiene id al que colgar la imagen: se guarda aqui y se
  // sube en cuanto crear() devuelve el id.
  const [imagenPendiente, setImagenPendiente] = useState(null);

  const editando = !!productoExistente;

  useEffect(() => {
    if (productoExistente) {
      setForm({
        nombre: productoExistente.nombre,
        categoria: productoExistente.categoria || '',
        p_venta: productoExistente.p_venta,
        p_costo: productoExistente.p_costo || '',
        stock: '',
        stock_min: productoExistente.stock_min || '',
        codigo_barras: productoExistente.codigo_barras || '',
        fuera_de_caja: !!productoExistente.fuera_de_caja,
      });
    }
  }, [productoExistente]);

  function cambiar(campo, valor) {
    setForm({ ...form, [campo]: valor });
    setError('');
  }

  async function guardar() {
    if (!form.nombre.trim()) { setError('El nombre es obligatorio.'); return; }
    if (form.p_venta === '') { setError('El precio de venta es obligatorio.'); return; }

    const entero = (v) => (v === '' ? 0 : parseInt(v, 10));
    const datos = {
      nombre: form.nombre.trim(),
      categoria: form.categoria.trim(),
      p_venta: entero(form.p_venta),
      p_costo: entero(form.p_costo),
      stock_min: entero(form.stock_min),
      codigo_barras: form.codigo_barras,
      fuera_de_caja: form.fuera_de_caja,
    };

    setGuardando(true);
    const r = editando
      ? await window.api.productos.editar(productoExistente.id, datos)
      : await window.api.productos.crear({ ...datos, stock: entero(form.stock) });

    if (!editando && imagenPendiente && r && r.id) {
      await window.api.imagenes.guardar({ entidad: 'producto', entidadId: r.id, base64: imagenPendiente });
    }
    setGuardando(false);

    if (r && r.ok === false) {
      setError(r.motivo === 'codigo_duplicado'
        ? 'Ese código de barras ya está en uso por otro producto.'
        : 'No se pudo guardar: ' + r.motivo);
      return;
    }
    onGuardado();
  }

  return (
    <div style={{ border: '1px solid var(--borde)', padding: 20, maxWidth: 420, marginTop: 20 }}>
      <h3>{editando ? 'Editar producto' : 'Nuevo producto'}</h3>

      <input placeholder="Nombre *" value={form.nombre} onChange={e => cambiar('nombre', e.target.value)} style={{ width: '100%' }} />
      <br /><input placeholder="Categoría" value={form.categoria} onChange={e => cambiar('categoria', e.target.value)} style={{ marginTop: 6, width: '100%' }} />
      <br /><input type="number" placeholder="Precio de venta *" value={form.p_venta} onChange={e => cambiar('p_venta', e.target.value)} style={{ marginTop: 6 }} />
      <br /><input type="number" placeholder="Precio de costo" value={form.p_costo} onChange={e => cambiar('p_costo', e.target.value)} style={{ marginTop: 6 }} />

      {!editando && (
        <><br /><input type="number" placeholder="Stock inicial" value={form.stock} onChange={e => cambiar('stock', e.target.value)} style={{ marginTop: 6 }} /></>
      )}

      <br /><input type="number" placeholder="Stock mínimo (avisa al llegar aquí)" value={form.stock_min} onChange={e => cambiar('stock_min', e.target.value)} style={{ marginTop: 6, width: '100%' }} />
      <br /><input placeholder="Código de barras (opcional)" value={form.codigo_barras} onChange={e => cambiar('codigo_barras', e.target.value)} style={{ marginTop: 6, width: '100%' }} />

      {editando && (
        <p style={{ color: 'var(--texto-suave)', fontSize: 13 }}>
          El stock no se edita aquí: se mueve desde <b>Ajustar stock</b>, para que
          cada cambio quede con su motivo.
        </p>
      )}

      {/* Lo que decide si el dinero de este producto es del gimnasio. Se elige
          aqui una sola vez y no en cada venta, para que el mostrador no pueda
          equivocarse cobrando con prisa. */}
      <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--borde-suave)', borderRadius: 'var(--radio)' }}>
        <label style={{ display: 'block', marginBottom: 6 }}>¿El dinero de este producto es del gimnasio?</label>
        {[
          { valor: false, titulo: 'Dentro de caja', detalle: 'Suma a las ventas e ingresos del gimnasio y entra al arqueo.' },
          { valor: true, titulo: 'Fuera de caja', detalle: 'Se cobra igual, pero no suma a las ventas ni al cierre de caja. Aparece en su propio resumen.' },
        ].map(o => (
          <label key={String(o.valor)} style={{
            display: 'block', padding: 8, marginTop: 6, cursor: 'pointer',
            borderRadius: 'var(--radio)',
            border: '1px solid ' + (form.fuera_de_caja === o.valor ? 'var(--acento)' : 'var(--borde-suave)'),
            background: form.fuera_de_caja === o.valor ? 'var(--superficie)' : 'transparent',
          }}>
            <input type="radio" name="destino-del-dinero" checked={form.fuera_de_caja === o.valor}
                   onChange={() => cambiar('fuera_de_caja', o.valor)} />
            <b style={{ marginLeft: 6 }}>{o.titulo}</b>
            <div style={{ fontSize: 12, color: 'var(--texto-suave)', marginLeft: 24 }}>{o.detalle}</div>
          </label>
        ))}
      </div>

      {/* 5.13/5.15: imagen del producto, por el mismo mecanismo que las fotos de
          cliente. Si no tiene, las pantallas dibujan sus iniciales. */}
      {/* El id sale de productoExistente, NO de `editando`, que es un booleano:
          `editando.id` era undefined y el selector creia que el producto aun no
          existia. Se quedaba la imagen en memoria, no se guardaba nunca y al
          reabrir la ficha volvia a salir vacia. */}
      <SelectorImagen
        entidad="producto"
        entidadId={productoExistente ? productoExistente.id : null}
        nombre={form.nombre}
        etiqueta="Imagen del producto"
        onCambio={(b64) => { if (!editando) setImagenPendiente(b64); }}
      />

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <button onClick={guardar} disabled={guardando} style={{ marginTop: 8 }}>
        {guardando ? 'Guardando...' : 'Guardar'}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}
