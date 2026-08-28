import { useState, useEffect } from 'react';

export default function ClienteForm({ clienteExistente, onGuardado, onCancelar }) {
  const [form, setForm] = useState({
    documento: '', nombre: '', telefono: '', email: '',
    f_nacimiento: '', contacto_emg: '', notas: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (clienteExistente) {
      setForm({
        documento: clienteExistente.documento || '',
        nombre: clienteExistente.nombre || '',
        telefono: clienteExistente.telefono || '',
        email: clienteExistente.email || '',
        f_nacimiento: clienteExistente.f_nacimiento || '',
        contacto_emg: clienteExistente.contacto_emg || '',
        notas: clienteExistente.notas || '',
      });
    }
  }, [clienteExistente]);

  function cambiar(campo, valor) {
    setForm({ ...form, [campo]: valor });
    setError('');
  }

  async function guardar() {
    if (!form.nombre.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setGuardando(true);
    if (clienteExistente) {
      await window.api.clientes.editar(clienteExistente.id, { ...form, foto: null });
    } else {
      await window.api.clientes.crear(form);
    }
    setGuardando(false);
    onGuardado();
  }

  return (
    <div style={{ border: '1px solid var(--borde)', padding: 20, maxWidth: 400, marginTop: 20 }}>
      <h3>{clienteExistente ? 'Editar cliente' : 'Nuevo cliente'}</h3>
      <input placeholder="Documento" value={form.documento} onChange={e => cambiar('documento', e.target.value)} />
      <br /><input placeholder="Nombre *" value={form.nombre} onChange={e => cambiar('nombre', e.target.value)} />
      <br /><input placeholder="Teléfono" value={form.telefono} onChange={e => cambiar('telefono', e.target.value)} />
      <br /><input placeholder="Email" value={form.email} onChange={e => cambiar('email', e.target.value)} />
      <br /><input type="date" placeholder="Fecha de nacimiento" value={form.f_nacimiento} onChange={e => cambiar('f_nacimiento', e.target.value)} />
      <br /><input placeholder="Contacto de emergencia" value={form.contacto_emg} onChange={e => cambiar('contacto_emg', e.target.value)} />
      <br /><textarea placeholder="Notas" value={form.notas} onChange={e => cambiar('notas', e.target.value)} />
      {error && <p style={{ color: 'var(--error)', maxWidth: 380 }}>{error}</p>}
      <button onClick={guardar} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}