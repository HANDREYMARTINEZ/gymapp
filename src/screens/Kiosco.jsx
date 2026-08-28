import { useState, useRef } from 'react';

const MENSAJES = {
  no_registrado: { color: 'var(--error)', texto: 'No registrado' },
  pin_incorrecto: { color: 'var(--error)', texto: 'PIN incorrecto. Intenta de nuevo o acércate a recepción' },
  ya_registrado_hoy: { color: 'var(--neutro)', texto: 'Ya registraste tu asistencia hoy' },
  sin_membresia: { color: 'var(--error)', texto: 'Sin membresía — pasa a recepción' },
  pausada: { color: 'var(--error)', texto: 'Membresía pausada — pasa a recepción' },
  saldo_pendiente: { color: 'var(--error)', texto: 'Saldo pendiente — pasa a recepción' },
  vencida: { color: 'var(--error)', texto: 'Tu membresía venció — pasa a recepción' },
  agotada: { color: 'var(--error)', texto: 'Tickets agotados — pasa a recepción' },
};

export default function Kiosco() {
  const [ult4, setUlt4] = useState('');
  const [pin, setPin] = useState('');
  const [resultado, setResultado] = useState(null);
  const [errorCampos, setErrorCampos] = useState('');
  const [enviando, setEnviando] = useState(false);
  const pinRef = useRef(null);
  const timeoutRef = useRef(null);

  function limpiarTodo() {
    setUlt4('');
    setPin('');
    setResultado(null);
    setErrorCampos('');
  }

  function programarLimpieza() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(limpiarTodo, 4000);
  }

  async function marcar() {
    if (ult4.length !== 4 || pin.length !== 4) {
      setErrorCampos('Ingresa los 4 dígitos del documento y los 4 del PIN');
      return;
    }
    setErrorCampos('');
    setEnviando(true);
    const r = await window.api.kiosco.marcarPorPin({ ult4, pin });
    setEnviando(false);
    setResultado(r);
    programarLimpieza();
  }

  function tecla(e) {
    if (e.key === 'Enter') marcar();
  }

  let bloque = null;
  if (resultado) {
    if (resultado.ok) {
      const esPorVencer = resultado.estado === 'por_vencer';
      bloque = (
        <div style={{ background: esPorVencer ? 'var(--aviso-solido)' : 'var(--exito-solido)', color: 'var(--texto)', padding: 40, borderRadius: 8, textAlign: 'center', fontSize: 28 }}>
          ✔ Bienvenido, {resultado.nombre}
          {esPorVencer && <div style={{ fontSize: 16, marginTop: 8 }}>Tu membresía está por vencer</div>}
        </div>
      );
    } else {
      const info = MENSAJES[resultado.motivo] || { color: 'var(--error)', texto: 'No se pudo registrar' };
      bloque = (
        <div style={{ background: info.color, color: 'var(--texto)', padding: 40, borderRadius: 8, textAlign: 'center', fontSize: 24 }}>
          {resultado.motivo === 'ya_registrado_hoy' ? '' : '✖ '}{resultado.nombre ? `${resultado.nombre} — ` : ''}{info.texto}
        </div>
      );
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '0 auto', textAlign: 'center', paddingTop: 60 }}>
      <h1>GymApp — Kiosco</h1>

      {bloque}

      {!resultado && (
        <div style={{ marginTop: 30 }}>
          <input
            placeholder="Últimos 4 del documento"
            value={ult4}
            maxLength={4}
            inputMode="numeric"
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '');
              setUlt4(v);
              if (v.length === 4) pinRef.current?.focus();
            }}
            onKeyDown={tecla}
            style={{ fontSize: 24, width: '100%', textAlign: 'center', padding: 10 }}
          />
          <input
            ref={pinRef}
            placeholder="PIN"
            value={pin}
            maxLength={4}
            type="password"
            inputMode="numeric"
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={tecla}
            style={{ fontSize: 24, width: '100%', textAlign: 'center', padding: 10, marginTop: 10 }}
          />
          {errorCampos && <p style={{ color: 'var(--error)', marginTop: 8 }}>{errorCampos}</p>}
          <button onClick={marcar} disabled={enviando} style={{ fontSize: 20, width: '100%', padding: 14, marginTop: 16 }}>
            {enviando ? 'Verificando...' : 'Marcar asistencia'}
          </button>
        </div>
      )}

      {resultado && (
        <button onClick={limpiarTodo} style={{ marginTop: 20 }}>Nuevo ingreso</button>
      )}
    </div>
  );
}