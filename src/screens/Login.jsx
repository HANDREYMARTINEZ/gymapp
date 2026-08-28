import { useState } from 'react';

export default function Login({ onLogin }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);

  async function entrar() {
    setError('');
    setEntrando(true);
    const res = await window.api.auth.login(usuario, password);
    setEntrando(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onLogin(res.usuario);
  }

  function tecla(e) {
    if (e.key === 'Enter') entrar();
  }

  return (
    <div style={{ padding: 40, maxWidth: 300 }}>
      <h1>GymApp</h1>
      <input placeholder="Usuario" value={usuario} onChange={e => setUsuario(e.target.value)} onKeyDown={tecla} />
      <br /><input type="password" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={tecla} />
      <br /><button onClick={entrar} disabled={entrando}>{entrando ? 'Entrando...' : 'Entrar'}</button>
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}