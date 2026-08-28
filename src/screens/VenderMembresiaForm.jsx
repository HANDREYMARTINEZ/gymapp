import { useState, useEffect } from 'react';

export default function VenderMembresiaForm({ clienteId, usuarioActual, onVendido, onCancelar }) {
  const [planes, setPlanes] = useState([]);
  const [planId, setPlanId] = useState('');
  const [descuento, setDescuento] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.api.planes.listar().then(setPlanes);
  }, []);

  async function vender() {
    if (!planId) {
      setError('Selecciona un plan.');
      return;
    }
    setGuardando(true);
    await window.api.membresias.vender({
      clienteId,
      planId: parseInt(planId, 10),
      usuarioId: usuarioActual.id,
      descuentoPct: parseFloat(descuento) || 0,
    });
    setGuardando(false);
    onVendido();
  }

  return (
    <div style={{ border: '1px solid #ccc', padding: 16, marginTop: 12, borderRadius: 4 }}>
      <h4>Vender membresía</h4>
      <select value={planId} onChange={e => { setPlanId(e.target.value); setError(''); }}>
        <option value="">-- Selecciona un plan --</option>
        {planes.map(p => (
          <option key={p.id} value={p.id}>{p.nombre} — ${p.precio.toLocaleString('es-CO')}</option>
        ))}
      </select>
      <br />
      <label>Descuento %: <input type="number" min="0" max="100" value={descuento} onChange={e => setDescuento(e.target.value)} style={{ width: 60 }} /></label>
      {error && <p style={{ color: 'darkred', maxWidth: 380 }}>{error}</p>}
      <button onClick={vender} disabled={guardando} style={{ marginTop: 8 }}>{guardando ? 'Vendiendo...' : 'Vender'}</button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}