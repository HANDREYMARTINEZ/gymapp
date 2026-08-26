import { useState } from 'react';

export default function PasoPassphrase({ onFinalizar }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function finalizar() {
    if (passphrase.length < 8) {
      alert('La passphrase debe tener al menos 8 caracteres');
      return;
    }
    if (passphrase !== confirmar) {
      alert('Las passphrases no coinciden');
      return;
    }
    setGuardando(true);
    await window.api.setup.finalizar(passphrase);
    setGuardando(false);
    onFinalizar();
  }

  return (
    <div>
      <h1>Passphrase de cifrado</h1>
      <p style={{ color: 'darkred', maxWidth: 400 }}>
        Esta clave protege los datos biométricos y los respaldos. Es <b>distinta</b> de tu contraseña de admin.
        Guárdala fuera de este computador — si la pierdes, necesitarás el proceso de recuperación.
      </p>
      <input type="password" placeholder="Passphrase" value={passphrase} onChange={e => setPassphrase(e.target.value)} />
      <br /><input type="password" placeholder="Confirmar passphrase" value={confirmar} onChange={e => setConfirmar(e.target.value)} />
      <br /><button onClick={finalizar} disabled={guardando}>{guardando ? 'Finalizando...' : 'Finalizar configuración'}</button>
    </div>
  );
}