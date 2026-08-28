import { useState, useEffect, useRef } from 'react';

export default function Desbloqueo({ onDesbloqueado }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [esperaSeg, setEsperaSeg] = useState(0);
  const temporizador = useRef(null);

  // La cuenta atrás se muestra para que la espera se entienda como un freno y no
  // como que la app se colgó. El backend la impone igual; esto solo la explica.
  useEffect(() => {
    if (esperaSeg <= 0) return;
    temporizador.current = setTimeout(() => setEsperaSeg(s => s - 1), 1000);
    return () => clearTimeout(temporizador.current);
  }, [esperaSeg]);

  const bloqueado = esperaSeg > 0;

  async function intentar() {
    if (bloqueado || verificando) return;
    setError('');
    setVerificando(true);
    const r = await window.api.desbloqueo.intentar(passphrase);
    setVerificando(false);

    if (!r.ok) {
      setError(r.error);
      if (r.esperaMs > 0) setEsperaSeg(Math.ceil(r.esperaMs / 1000));
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
      <input type="password" placeholder="Passphrase" value={passphrase}
             onChange={e => { setPassphrase(e.target.value); setError(''); }}
             onKeyDown={tecla} disabled={bloqueado} style={{ width: '100%' }} />
      <br /><button onClick={intentar} disabled={verificando || bloqueado} style={{ marginTop: 10 }}>
        {verificando ? 'Verificando...' : bloqueado ? 'Espera ' + esperaSeg + 's' : 'Desbloquear'}
      </button>
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}
