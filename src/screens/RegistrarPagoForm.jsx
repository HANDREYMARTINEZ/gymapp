import { useState } from 'react';

const MEDIOS = ['Efectivo', 'Nequi', 'Daviplata', 'Tarjeta', 'Transferencia'];

export default function RegistrarPagoForm({ membresiaId, usuarioActual, onGuardado, onCancelar }) {
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function guardar() {
    const montoNum = parseInt(monto, 10);
    if (!montoNum || montoNum <= 0) {
      setError('Ingresa un monto válido.');
      return;
    }
    setGuardando(true);
    const r = await window.api.membresias.registrarPago({
      membresiaId, monto: montoNum, metodo, usuarioId: usuarioActual.id, nota,
    });
    setGuardando(false);

    if (r && r.ok === false) {
      setError(r.motivo === 'sin_caja_abierta'
        ? 'No hay una caja abierta. Un pago en efectivo entra al cajón, así que abre la caja primero.'
        : 'No se pudo registrar el pago: ' + r.motivo);
      return;
    }
    onGuardado();
  }

  return (
    <div style={{ border: '1px solid #ccc', padding: 16, marginTop: 12, borderRadius: 4 }}>
      <h4>Registrar pago</h4>
      <input type="number" placeholder="Monto" value={monto}
             onChange={e => { setMonto(e.target.value); setError(''); }} />
      <br />
      <select value={metodo} onChange={e => { setMetodo(e.target.value); setError(''); }}>
        {MEDIOS.map(m => <option key={m}>{m}</option>)}
      </select>
      <br /><input placeholder="Nota (opcional)" value={nota} onChange={e => setNota(e.target.value)} />

      {error && <p style={{ color: 'darkred', maxWidth: 380 }}>{error}</p>}

      <br /><button onClick={guardar} disabled={guardando} style={{ marginTop: 8 }}>
        {guardando ? 'Guardando...' : 'Guardar pago'}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}
