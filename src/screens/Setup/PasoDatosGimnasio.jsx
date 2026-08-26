import { useState } from 'react';

export default function PasoDatosGimnasio({ onSiguiente }) {
  const [form, setForm] = useState({ nombre: '', direccion: '', telefono: '', nit: '' });
  const [guardando, setGuardando] = useState(false);

  function cambiar(campo, valor) {
    setForm({ ...form, [campo]: valor });
  }

  async function continuar() {
    if (!form.nombre.trim()) {
      alert('El nombre del gimnasio es obligatorio');
      return;
    }
    setGuardando(true);
    await window.api.setup.guardarDatosGimnasio(form);
    setGuardando(false);
    onSiguiente();
  }

  return (
    <div>
      <h1>Datos del gimnasio</h1>
      <input placeholder="Nombre del gimnasio *" value={form.nombre} onChange={e => cambiar('nombre', e.target.value)} />
      <br /><input placeholder="Dirección" value={form.direccion} onChange={e => cambiar('direccion', e.target.value)} />
      <br /><input placeholder="Teléfono" value={form.telefono} onChange={e => cambiar('telefono', e.target.value)} />
      <br /><input placeholder="NIT" value={form.nit} onChange={e => cambiar('nit', e.target.value)} />
      <br /><button onClick={continuar} disabled={guardando}>{guardando ? 'Guardando...' : 'Siguiente'}</button>
    </div>
  );
}