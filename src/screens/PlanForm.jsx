import { useState, useEffect } from 'react';

export default function PlanForm({ planExistente, onGuardado, onCancelar }) {
  const [form, setForm] = useState({
    nombre: '', tipo: 'periodo', precio: '',
    dias_duracion: '', num_tickets: '', dias_vigencia: '', color: '#4fc3f7',
  });
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (planExistente) {
      setForm({
        nombre: planExistente.nombre,
        tipo: planExistente.tipo,
        precio: planExistente.precio,
        dias_duracion: planExistente.dias_duracion || '',
        num_tickets: planExistente.num_tickets || '',
        dias_vigencia: planExistente.dias_vigencia || '',
        color: planExistente.color || '#4fc3f7',
      });
    }
  }, [planExistente]);

  function cambiar(campo, valor) {
    setForm({ ...form, [campo]: valor });
  }

  async function guardar() {
    if (!form.nombre.trim() || !form.precio) {
      alert('Nombre y precio son obligatorios');
      return;
    }
    if (form.tipo === 'periodo' && !form.dias_duracion) {
      alert('Los días de duración son obligatorios para un plan tipo periodo');
      return;
    }
    if (form.tipo === 'ticketera' && !form.num_tickets) {
      alert('El número de tickets es obligatorio para un plan tipo ticketera');
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
    <div style={{ border: '1px solid #ccc', padding: 20, maxWidth: 400, marginTop: 20 }}>
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
      <br /><button onClick={guardar} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
      <button onClick={onCancelar} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}