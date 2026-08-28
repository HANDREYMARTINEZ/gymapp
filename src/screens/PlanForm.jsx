import { useState, useEffect } from 'react';

export default function PlanForm({ planExistente, onGuardado, onCancelar }) {
  const [form, setForm] = useState({
    nombre: '', tipo: 'periodo', precio: '',
    dias_duracion: '', num_tickets: '', dias_vigencia: '', color: '#3b5bdb',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (planExistente) {
      setForm({
        nombre: planExistente.nombre,
        tipo: planExistente.tipo,
        precio: planExistente.precio,
        dias_duracion: planExistente.dias_duracion || '',
        num_tickets: planExistente.num_tickets || '',
        dias_vigencia: planExistente.dias_vigencia || '',
        color: planExistente.color || '#3b5bdb',
      });
    }
  }, [planExistente]);

  function cambiar(campo, valor) {
    setForm({ ...form, [campo]: valor });
    setError('');
  }

  async function guardar() {
    if (!form.nombre.trim() || !form.precio) {
      setError('Nombre y precio son obligatorios.');
      return;
    }
    if (form.tipo === 'periodo' && !form.dias_duracion) {
      setError('Los días de duración son obligatorios para un plan de tipo periodo.');
      return;
    }
    if (form.tipo === 'ticketera' && !form.num_tickets) {
      setError('El número de tickets es obligatorio para un plan de tipo ticketera.');
      return;
    }

    const datos = {
      nombre: form.nombre,
      tipo: form.tipo,
      precio: parseInt(form.precio, 10),
      dias_duracion: form.dias_duracion ? parseInt(form.dias_duracion, 10) : null,
      num_tickets: form.num_tickets ? parseInt(form.num_tickets, 10) : null,
      dias_vigencia: form.dias_vigencia ? parseInt(form.dias_vigencia, 10) : null,
      color: form.color,
    };

    setGuardando(true);
    if (planExistente) {
      await window.api.planes.editar(planExistente.id, datos);
    } else {
      await window.api.planes.crear(datos);
    }
    setGuardando(false);
    onGuardado();
  }

  return (
    <div style={{ border: '1px solid var(--borde)', padding: 20, maxWidth: 400, marginTop: 20 }}>
      <h3>{planExistente ? 'Editar plan' : 'Nuevo plan'}</h3>
      <input placeholder="Nombre *" value={form.nombre} onChange={e => cambiar('nombre', e.target.value)} />
      <br />
      <select value={form.tipo} onChange={e => cambiar('tipo', e.target.value)} disabled={!!planExistente}>
        <option value="periodo">Periodo (ej. mensualidad)</option>
        <option value="ticketera">Ticketera (paquete de tickets)</option>
      </select>
      {planExistente && <small> (el tipo no se puede cambiar después de creado)</small>}
      <br /><input type="number" placeholder="Precio *" value={form.precio} onChange={e => cambiar('precio', e.target.value)} />

      {form.tipo === 'periodo' && (
        <><br /><input type="number" placeholder="Días de duración *" value={form.dias_duracion} onChange={e => cambiar('dias_duracion', e.target.value)} /></>
      )}
      {form.tipo === 'ticketera' && (
        <>
          <br /><input type="number" placeholder="Número de tickets *" value={form.num_tickets} onChange={e => cambiar('num_tickets', e.target.value)} />
          <br /><input type="number" placeholder="Días de vigencia (opcional)" value={form.dias_vigencia} onChange={e => cambiar('dias_vigencia', e.target.value)} />
        </>
      )}

      <br /><input type="color" value={form.color} onChange={e => cambiar('color', e.target.value)} />
      {error && <p style={{ color: 'var(--error)', maxWidth: 380 }}>{error}</p>}

      <br /><button onClick={guardar} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}