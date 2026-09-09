import { useState, useEffect } from 'react';

function hoyISO() {
  const d = new Date();
  return [d.getFullYear(),
          String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0')].join('-');
}

export default function VenderMembresiaForm({ clienteId, usuarioActual, onVendido, onCancelar }) {
  const [planes, setPlanes] = useState([]);
  const [planId, setPlanId] = useState('');
  const [descuento, setDescuento] = useState(0);
  const [fInicio, setFInicio] = useState('');
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
      // Vacio significa "como siempre": empieza cuando termina la anterior del
      // mismo tipo. Solo se manda fecha si el mostrador la eligio a proposito.
      fInicio: fInicio || null,
    });
    setGuardando(false);
    onVendido();
  }

  return (
    <div style={{ border: '1px solid var(--borde)', padding: 16, marginTop: 12, borderRadius: 'var(--radio)' }}>
      <h4>Vender membresía</h4>
      <select value={planId} onChange={e => { setPlanId(e.target.value); setError(''); }}>
        <option value="">-- Selecciona un plan --</option>
        {planes.map(p => (
          <option key={p.id} value={p.id}>{p.nombre} — ${p.precio.toLocaleString('es-CO')}</option>
        ))}
      </select>

      <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'block' }}>
          Empieza el<br />
          <input type="date" value={fInicio} max="2999-12-31"
                 onChange={e => { setFInicio(e.target.value); setError(''); }} />
        </label>
        <label style={{ display: 'block' }}>
          Descuento %<br />
          <input type="number" min="0" max="100" value={descuento}
                 onChange={e => setDescuento(e.target.value)} style={{ width: 70 }} />
        </label>
      </div>

      <p style={{ fontSize: 12, color: 'var(--texto-tenue)', marginBottom: 0 }}>
        {fInicio
          ? (fInicio > hoyISO()
              ? 'Queda programada: el cliente no podrá entrar hasta esa fecha.'
              : 'Empieza el ' + fInicio + '.')
          : 'Si lo dejas vacío, empieza cuando termine la membresía anterior del mismo tipo.'}
      </p>

      {error && <p style={{ color: 'var(--error)', maxWidth: 380 }}>{error}</p>}
      <button onClick={vender} disabled={guardando} style={{ marginTop: 8 }}>{guardando ? 'Vendiendo...' : 'Vender'}</button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}
