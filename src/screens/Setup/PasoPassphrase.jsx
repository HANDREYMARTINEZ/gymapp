import { useState } from 'react';

export default function PasoPassphrase({ onFinalizar }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function finalizar() {
    if (passphrase.length < 8) {
      setError('La passphrase debe tener al menos 8 caracteres.');
      return;
    }
    if (passphrase !== confirmar) {
      setError('Las passphrases no coinciden.');
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
        Esta clave protege los datos biométricos y los respaldos. Es <b>distinta</b> de tu
        contraseña de administrador: esta se pide al arrancar la app, y es la única que abre
        los archivos de respaldo.
        <br /><br />
        <b>Anótala fuera de este computador antes de continuar.</b> Si la pierdes, los
        respaldos quedan ilegibles y no hay forma de recuperarlos.
      </p>
      <input type="password" placeholder="Passphrase" value={passphrase}
             onChange={e => { setPassphrase(e.target.value); setError(''); }} />
      <br /><input type="password" placeholder="Confirmar passphrase" value={confirmar}
                   onChange={e => { setConfirmar(e.target.value); setError(''); }} />

      {error && <p style={{ color: 'darkred', maxWidth: 400 }}>{error}</p>}

      <br /><button onClick={finalizar} disabled={guardando}>{guardando ? 'Finalizando...' : 'Finalizar configuración'}</button>
    </div>
  );
}