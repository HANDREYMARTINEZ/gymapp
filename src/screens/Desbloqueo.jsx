import { useState } from 'react';

export default function Desbloqueo({ onDesbloqueado }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [verificando, setVerificando] = useState(false);

  async function intentar() {
    setError('');
    setVerificando(true);
    const r = await window.api.desbloqueo.intentar(passphrase);
    setVerificando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onDesbloqueado();
  }

  function tecla(e) {
    if (e.key === 'Enter') intentar();
  }

  return (
    <div style={{ padding: 40, maxWidth: 350 }}>
      <h1>GymApp</h1>
      <p>Ingresa la passphrase de cifrado para continuar.</p>
      <input type="password" placeholder="Passphrase" value={passphrase} onChange={e => setPassphrase(e.target.value)} onKeyDown={tecla} style={{ width: '100%' }} />
      <br /><button onClick={intentar} disabled={verificando} style={{ marginTop: 10 }}>{verificando ? 'Verificando...' : 'Desbloquear'}</button>
      {error && <p style={{ color: 'darkred' }}>{error}</p>}
    </div>
  );
}