import { useState, useEffect } from 'react';

const MOTIVOS_FECHA = {
  no_existe: 'Esa membresía ya no está.',
  esta_anulada: 'No se puede cambiar la fecha de una membresía eliminada.',
  fecha_invalida: 'La fecha de inicio no es válida.',
};

export default function RegistrarPagoForm({ membresiaId, fInicioActual, usuarioActual, onGuardado, onCancelar }) {
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [nota, setNota] = useState('');
  const [fInicio, setFInicio] = useState(fInicioActual || '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  // La lista venia copiada a mano aqui. Se pide al proceso principal, que es
  // donde vive el unico vocabulario: con dos copias, anadir un medio en una
  // dejaba la otra desalineada sin que nada fallara.
  const [medios, setMedios] = useState(['Efectivo']);

  useEffect(() => { window.api.ventas.mediosPago().then(setMedios); }, []);

  const cambiaFecha = !!fInicioActual && !!fInicio && fInicio !== fInicioActual;

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

    if (r && r.ok === false) {
      setGuardando(false);
      setError(r.motivo === 'sin_caja_abierta'
        ? 'No hay una caja abierta. Un pago en efectivo entra al cajón, así que abre la caja primero.'
        : 'No se pudo registrar el pago: ' + r.motivo);
      return;
    }

    // La fecha se cambia despues del pago y no antes: si el pago se rechaza (por
    // ejemplo sin caja abierta) la membresia queda como estaba. Al reves habria
    // quedado movida sin que entrase el dinero.
    if (cambiaFecha) {
      const f = await window.api.membresias.cambiarFechaInicio({
        membresiaId, fInicio, usuarioId: usuarioActual.id,
      });
      if (!f.ok) {
        setGuardando(false);
        setError('El pago sí se registró, pero no se pudo cambiar la fecha de inicio: '
                 + (MOTIVOS_FECHA[f.motivo] || f.motivo));
        return;
      }
    }

    setGuardando(false);
    onGuardado();
  }

  return (
    <div style={{ border: '1px solid var(--borde)', padding: 16, marginTop: 12, borderRadius: 'var(--radio)' }}>
      <h4 style={{ marginTop: 0 }}>Registrar pago</h4>
      <input type="number" placeholder="Monto" value={monto}
             onChange={e => { setMonto(e.target.value); setError(''); }} />
      <br />
      <select value={metodo} onChange={e => { setMetodo(e.target.value); setError(''); }}>
        {medios.map(m => <option key={m}>{m}</option>)}
      </select>
      <br /><input placeholder="Nota (opcional)" value={nota} onChange={e => setNota(e.target.value)} />

      {fInicioActual && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--borde-suave)' }}>
          <label style={{ display: 'block' }}>
            La membresía cuenta desde<br />
            <input type="date" value={fInicio}
                   onChange={e => { setFInicio(e.target.value); setError(''); }} />
          </label>
          <p style={{ fontSize: 12, color: cambiaFecha ? 'var(--aviso)' : 'var(--texto-tenue)', marginBottom: 0 }}>
            {cambiaFecha
              ? 'La fecha de fin se moverá los mismos días, así que la membresía dura lo mismo.'
              : 'Cámbiala solo si el cliente empezó otro día.'}
          </p>
        </div>
      )}

      {error && <p style={{ color: 'var(--error)', maxWidth: 380 }}>{error}</p>}

      <br /><button onClick={guardar} disabled={guardando} style={{ marginTop: 8 }}>
        {guardando ? 'Guardando...' : 'Guardar pago'}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}
