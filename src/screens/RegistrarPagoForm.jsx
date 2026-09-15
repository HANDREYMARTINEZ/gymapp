import { useState, useEffect } from 'react';

const MOTIVOS_FECHA = {
  no_existe: 'Esa membresía ya no está.',
  esta_anulada: 'No se puede cambiar la fecha de una membresía eliminada.',
  fecha_invalida: 'La fecha de inicio no es válida.',
};

const MOTIVOS_FIAR = {
  sin_saldo: 'Esta membresía ya no debe nada.',
  esta_anulada: 'No se puede fiar una membresía eliminada.',
  fecha_invalida: 'Elige la fecha en que va a pagar.',
  fecha_pasada: 'La fecha de pago no puede ser anterior a hoy.',
};

function hoyISO() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

export default function RegistrarPagoForm({ membresiaId, fInicioActual, saldo, fiadoHastaActual, usuarioActual, onGuardado, onCancelar }) {
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
  // Fiar lo que falta no es un pago: no se registra dinero, se pone la fecha en
  // que pagara. Hasta ese dia el cliente entra aunque deba (decision del
  // 15-sep-2026). Para abonar una parte y fiar el resto: primero el pago, luego
  // esto.
  const [medioFiado, setMedioFiado] = useState(null);
  const [fiadoHasta, setFiadoHasta] = useState(fiadoHastaActual || '');
  const esFiado = !!medioFiado && metodo === medioFiado;

  useEffect(() => {
    window.api.ventas.mediosPago().then(setMedios);
    window.api.ventas.medioFiado().then(setMedioFiado);
  }, []);

  async function fiar() {
    if (!fiadoHasta) { setError(MOTIVOS_FIAR.fecha_invalida); return; }
    setGuardando(true);
    const r = await window.api.membresias.fiar({ membresiaId, fiadoHasta, usuarioId: usuarioActual.id });
    setGuardando(false);
    if (!r.ok) { setError(MOTIVOS_FIAR[r.motivo] || 'No se pudo fiar: ' + r.motivo); return; }
    onGuardado();
  }

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
        : r.motivo === 'medio_pago_invalido'
          ? 'Elige un medio de pago válido.'
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
      {!esFiado && (
        <input type="number" placeholder="Monto" value={monto}
               onChange={e => { setMonto(e.target.value); setError(''); }} />
      )}
      {!esFiado && <br />}
      <select value={metodo} onChange={e => { setMetodo(e.target.value); setError(''); }}>
        {medios.map(m => <option key={m}>{m}</option>)}
        {medioFiado && <option value={medioFiado}>{medioFiado} (paga después)</option>}
      </select>

      {esFiado ? (
        <div style={{ marginTop: 10 }}>
          <label style={{ display: 'block' }}>
            Paga el<br />
            <input type="date" value={fiadoHasta} min={hoyISO()} max="2999-12-31"
                   onChange={e => { setFiadoHasta(e.target.value); setError(''); }} />
          </label>
          <p style={{ fontSize: 12, color: 'var(--texto-tenue)', marginBottom: 0, maxWidth: 380 }}>
            Se le fían {saldo != null ? <b>{'$' + saldo.toLocaleString('es-CO')}</b> : 'lo que falta'}. Hasta ese día
            entra normal; si llega la fecha y no ha pagado, el kiosco lo manda a recepción.
            Si abona una parte ahora, registra primero ese pago y después fía el resto.
          </p>
        </div>
      ) : (
        <><br /><input placeholder="Nota (opcional)" value={nota} onChange={e => setNota(e.target.value)} /></>
      )}

      {fInicioActual && !esFiado && (
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

      <br /><button onClick={esFiado ? fiar : guardar} disabled={guardando} style={{ marginTop: 8 }}>
        {guardando ? 'Guardando...' : (esFiado ? 'Fiar' : 'Guardar pago')}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}
