import { useState } from 'react';

export default function RegistrarPagoForm({ membresiaId, usuarioActual, onGuardado, onCancelar }) {
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    const montoNum = parseInt(monto, 10);
    if (!montoNum || montoNum <= 0) {
      alert('Ingresa un monto válido');
      return;
    }
    setGuardando(true);
    await window.api.membresias.registrarPago({
      membresiaId, monto: montoNum, metodo, usuarioId: usuarioActual.id, nota,
    });
    setGuardando(false);
    onGuardado();
  }

  return (
    <div style={{ border: '1px solid #ccc', padding: 16, marginTop: 12, borderRadius: 4 }}>
      <h4>Registrar pago</h4>
      <input type="number" placeholder="Monto" value={monto} onChange={e => setMonto(e.target.value)} />
      <br />
      <select value={metodo} onChange={e => setMetodo(e.target.value)}>
        <option>Efectivo</option>
        <option>Nequi</option>
        <option>Daviplata</option>
        <option>Tarjeta</option>
        <option>Transferencia</option>
      </select>
      <br /><input placeholder="Nota (opcional)" value={nota} onChange={e => setNota(e.target.value)} />
      <br /><button onClick={guardar} disabled={guardando} style={{ marginTop: 8 }}>{guardando ? 'Guardando...' : 'Guardar pago'}</button>
      <button onClick={onCancelar} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}