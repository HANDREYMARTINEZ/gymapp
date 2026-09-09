import { useState, useRef, useEffect } from 'react';
import Miniatura from '../components/Miniatura';

const MENSAJES = {
  no_registrado: { color: 'var(--error)', texto: 'No registrado' },
  pin_incorrecto: { color: 'var(--error)', texto: 'PIN incorrecto. Intenta de nuevo o acércate a recepción' },
  ya_registrado_hoy: { color: 'var(--neutro)', texto: 'Ya registraste tu asistencia hoy' },
  sin_membresia: { color: 'var(--error)', texto: 'Sin membresía — pasa a recepción' },
  pausada: { color: 'var(--error)', texto: 'Membresía pausada — pasa a recepción' },
  programada: { color: 'var(--error)', texto: 'Tu membresía aún no empieza — pasa a recepción' },
  saldo_pendiente: { color: 'var(--error)', texto: 'Saldo pendiente — pasa a recepción' },
  vencida: { color: 'var(--error)', texto: 'Tu membresía venció — pasa a recepción' },
  agotada: { color: 'var(--error)', texto: 'Tickets agotados — pasa a recepción' },
};

export default function Kiosco() {
  const [nombreGym, setNombreGym] = useState('');

  useEffect(() => {
    window.api.config.get('gym_nombre').then(v => setNombreGym(v || 'GymApp'));
    // Sin lector conectado esto rechaza con 'sin_lector', y eso NO es un fallo:
    // el kiosco sigue entrando por PIN, que es como funciona hoy el gimnasio.
    // Sin este catch quedaba una promesa rechazada suelta cada vez que se abria
    // la pantalla, que es ruido en la consola y, el dia que haya un manejador
    // global de errores, una alarma falsa.
    window.api.kiosco.iniciarEscuchaHuella().catch(() => {});
    window.api.kiosco.onHuellaDetectada((data) => {
      setResultado(data);
      programarLimpieza();
    });
  }, []);
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

  // La foto va grande: a un metro del mostrador, quien atiende reconoce la cara
  // antes que el nombre. Si el cliente no tiene, se ven sus iniciales.
  const retrato = (nombre) => (
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
      <div style={{ width: 140, height: 140, borderRadius: '50%', overflow: 'hidden', border: '3px solid rgba(255,255,255,0.55)' }}>
        <Miniatura url={resultado.foto} nombre={nombre} lado="100%" radio="50%" fuente={48} />
      </div>
    </div>
  );

  // El aviso de cedula pendiente va debajo del mensaje y no en lugar de el: el
  // cliente entra igual -- que le falte el documento no es motivo para dejarlo
  // fuera -- pero quien atiende tiene que enterarse justo cuando lo tiene
  // delante, que es el unico momento en que se le puede pedir la cedula.
  const avisoDocumento = resultado && resultado.documentoProvisional ? (
    <div style={{
      marginTop: 12, padding: '10px 14px', fontSize: 15,
      background: 'var(--aviso-fondo)', border: '1px solid var(--aviso)',
      borderRadius: 'var(--radio)', color: 'var(--aviso)',
    }}>
      {'\u26A0'} Este cliente todav&iacute;a no tiene documento. Se le puso una
      c&eacute;dula provisional ({resultado.documento || 'temporal'}); p&iacute;dele
      la real y escr&iacute;bela en su ficha.
    </div>
  ) : null;

  let bloque = null;
  if (resultado) {
    if (resultado.ok) {
      const esPorVencer = resultado.estado === 'por_vencer';
      bloque = (
        <div style={{ background: esPorVencer ? 'var(--aviso-solido)' : 'var(--exito-solido)', color: 'var(--texto)', padding: 30, borderRadius: 8, textAlign: 'center', fontSize: 28 }}>
          {retrato(resultado.nombre)}
          ✔ Bienvenido, {resultado.nombre}
          {esPorVencer && <div style={{ fontSize: 16, marginTop: 8 }}>Tu membresía está por vencer</div>}
        </div>
      );
    } else {
      const info = MENSAJES[resultado.motivo] || { color: 'var(--error)', texto: 'No se pudo registrar' };
      bloque = (
        <div style={{ background: info.color, color: 'var(--texto)', padding: 30, borderRadius: 8, textAlign: 'center', fontSize: 24 }}>
          {/* Tambien cuando no se le deja entrar: quien atiende necesita ver a
              quien esta rechazando, sobre todo si el motivo es un saldo. */}
          {resultado.nombre && retrato(resultado.nombre)}
          {resultado.motivo === 'ya_registrado_hoy' ? '' : '✖ '}{resultado.nombre ? `${resultado.nombre} — ` : ''}{info.texto}
        </div>
      );
    }
  }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', textAlign: 'center', paddingTop: 48 }}>
      {/* El kiosco se lee de pie y a un par de metros, no sentado frente a la
          pantalla como el resto de la app. Por eso el nombre del gimnasio no usa
          el tamano de titulo normal (26px): va mucho mas grande y en negrita. */}
      <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: 0.5, color: 'var(--acento-claro)', margin: '0 0 6px' }}>
        {nombreGym}
      </h1>
      <p style={{ fontSize: 26, fontWeight: 700, color: 'var(--texto)', margin: '0 0 6px' }}>
        Bienvenidos al {nombreGym}
      </p>
      <p style={{ fontSize: 16, color: 'var(--texto-suave)', margin: '0 0 28px' }}>
        Ingresa tu huella o tu clave de usuario
      </p>

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

      {avisoDocumento}
      {resultado && (
        <button onClick={limpiarTodo} style={{ marginTop: 20 }}>Nuevo ingreso</button>
      )}
    </div>
  );
}