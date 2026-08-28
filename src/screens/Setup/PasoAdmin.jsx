import { useState } from 'react';

const MOTIVOS = {
  nombre_requerido: 'Escribe tu nombre completo.',
  usuario_muy_corto: 'El usuario debe tener al menos 3 caracteres.',
  password_muy_corta: 'La contraseña debe tener al menos 4 caracteres.',
  usuario_ya_existe: 'Ese usuario ya está tomado.',
};

export default function PasoAdmin({ onSiguiente }) {
  const [form, setForm] = useState({ nombre: '', usuario: '', password: '', password2: '' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  function cambiar(campo, valor) {
    setForm({ ...form, [campo]: valor });
    setError('');
  }

  async function continuar() {
    if (!form.nombre.trim() || !form.usuario.trim() || !form.password) {
      setError('Todos los campos son obligatorios.');
      return;
    }
    if (form.password !== form.password2) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setGuardando(true);
    const r = await window.api.setup.crearAdmin({
      nombre: form.nombre, usuario: form.usuario, password: form.password,
    });
    setGuardando(false);

    if (r && r.ok === false) {
      setError(MOTIVOS[r.motivo] || 'No se pudo crear el usuario: ' + r.motivo);
      return;
    }
    onSiguiente();
  }

  return (
    <div>
      <h1>Crear usuario administrador</h1>
      <input placeholder="Tu nombre completo" value={form.nombre} onChange={e => cambiar('nombre', e.target.value)} />
      <br /><input placeholder="Usuario (para iniciar sesión)" value={form.usuario} onChange={e => cambiar('usuario', e.target.value)} />
      <br /><small style={{ color: '#666' }}>No distingue mayúsculas de minúsculas.</small>
      <br /><input type="password" placeholder="Contraseña" value={form.password} onChange={e => cambiar('password', e.target.value)} />
      <br /><input type="password" placeholder="Confirmar contraseña" value={form.password2} onChange={e => cambiar('password2', e.target.value)} />

      {error && <p style={{ color: 'darkred', maxWidth: 340 }}>{error}</p>}

      <br /><button onClick={continuar} disabled={guardando}>{guardando ? 'Guardando...' : 'Siguiente'}</button>
    </div>
  );
}
