import { useState } from 'react';

export default function PasoAdmin({ onSiguiente }) {
  const [form, setForm] = useState({ nombre: '', usuario: '', password: '', password2: '' });
  const [guardando, setGuardando] = useState(false);

  function cambiar(campo, valor) {
    setForm({ ...form, [campo]: valor });
  }

  async function continuar() {
    if (!form.nombre.trim() || !form.usuario.trim() || !form.password) {
      alert('Todos los campos son obligatorios');
      return;
    }
    if (form.password !== form.password2) {
      alert('Las contraseñas no coinciden');
      return;
    }
    setGuardando(true);
    await window.api.setup.crearAdmin({ nombre: form.nombre, usuario: form.usuario, password: form.password });
    setGuardando(false);
    onSiguiente();
  }

  return (
    <div>
      <h1>Crear usuario administrador</h1>
      <input placeholder="Tu nombre completo" value={form.nombre} onChange={e => cambiar('nombre', e.target.value)} />
      <br /><input placeholder="Usuario (para iniciar sesión)" value={form.usuario} onChange={e => cambiar('usuario', e.target.value)} />
      <br /><input type="password" placeholder="Contraseña" value={form.password} onChange={e => cambiar('password', e.target.value)} />
      <br /><input type="password" placeholder="Confirmar contraseña" value={form.password2} onChange={e => cambiar('password2', e.target.value)} />
      <br /><button onClick={continuar} disabled={guardando}>{guardando ? 'Guardando...' : 'Siguiente'}</button>
    </div>
  );
}