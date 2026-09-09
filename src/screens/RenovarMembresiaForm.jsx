import { useState } from 'react';

const MOTIVOS = {
  no_existe: 'Esa membresía ya no está.',
  plan_no_existe: 'El plan de esta membresía ya no existe en el catálogo.',
  plan_inactivo: 'El plan de esta membresía está desactivado. Actívalo en Planes o vende otro plan.',
  fecha_invalida: 'La fecha de inicio no es válida.',
};

// Renovar es vender otra vez el mismo plan, asi que el formulario solo pregunta
// lo que puede cambiar entre una y otra: cuando empieza y que descuento lleva.
export default function RenovarMembresiaForm({ membresia, usuarioActual, onRenovado, onCancelar }) {
  const [fInicio, setFInicio] = useState('');
  const [descuento, setDescuento] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function renovar() {
    setGuardando(true);
    const r = await window.api.membresias.renovar({
      membresiaId: membresia.id,
      usuarioId: usuarioActual.id,
      descuentoPct: parseFloat(descuento) || 0,
      fInicio: fInicio || null,
    });
    setGuardando(false);
    if (!r.ok) {
      setError(MOTIVOS[r.motivo] || 'No se pudo renovar: ' + r.motivo);
      return;
    }
    onRenovado();
  }

  return (
    <div style={{ marginTop: 8, padding: 12, background: 'var(--superficie-alta)', borderRadius: 'var(--radio)' }}
         onClick={e => e.stopPropagation()}>
      <h4 style={{ marginTop: 0 }}>Renovar {membresia.plan_nombre}</h4>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'block' }}>
          Empieza el<br />
          <input type="date" value={fInicio} onChange={e => { setFInicio(e.target.value); setError(''); }} />
        </label>
        <label style={{ display: 'block' }}>
          Descuento %<br />
          <input type="number" min="0" max="100" value={descuento}
                 onChange={e => setDescuento(e.target.value)} style={{ width: 70 }} />
        </label>
      </div>

      <p style={{ fontSize: 12, color: 'var(--texto-tenue)', marginBottom: 0 }}>
        Si lo dejas vacío, la nueva empieza justo cuando termina esta.
      </p>

      {error && <p style={{ color: 'var(--error)', maxWidth: 380 }}>{error}</p>}

      <button onClick={renovar} disabled={guardando} style={{ marginTop: 8 }}>
        {guardando ? 'Renovando...' : 'Confirmar renovación'}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}
