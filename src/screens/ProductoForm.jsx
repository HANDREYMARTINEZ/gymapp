import { useState, useEffect } from 'react';

export default function ProductoForm({ productoExistente, onGuardado, onCancelar }) {
  const [form, setForm] = useState({
    nombre: '', categoria: '', p_venta: '', p_costo: '',
    stock: '', stock_min: '', codigo_barras: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

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
    };

    setGuardando(true);
    const r = editando
      ? await window.api.productos.editar(productoExistente.id, datos)
      : await window.api.productos.crear({ ...datos, stock: entero(form.stock) });
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

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <button onClick={guardar} disabled={guardando} style={{ marginTop: 8 }}>
        {guardando ? 'Guardando...' : 'Guardar'}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}
