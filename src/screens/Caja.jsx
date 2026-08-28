import { useState, useEffect } from 'react';

const pesos = (n) => '$' + (n || 0).toLocaleString('es-CO');

function fechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function soloHora(iso) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function Diferencia({ valor }) {
  if (valor === 0) return <b style={{ color: 'darkgreen' }}>Cuadró exacto</b>;
  const falta = valor < 0;
  return (
    <b style={{ color: 'darkred' }}>
      {falta ? 'Faltan ' : 'Sobran '}{pesos(Math.abs(valor))}
    </b>
  );
}

function AbrirCaja({ usuarioActual, onAbierta }) {
  const [base, setBase] = useState('');
  const [error, setError] = useState('');
  const [abriendo, setAbriendo] = useState(false);

  async function abrir() {
    if (base === '' || parseInt(base, 10) < 0) {
      setError('Escribe con cuánto efectivo empieza la caja (puede ser 0).');
      return;
    }
    setAbriendo(true);
    const r = await window.api.caja.abrir({
      usuarioId: usuarioActual.id,
      baseInicial: parseInt(base, 10),
    });
    setAbriendo(false);
    if (!r.ok) {
      setError(r.motivo === 'ya_hay_sesion_abierta'
        ? 'Ya hay una caja abierta. Ciérrala antes de abrir otra.'
        : 'No se pudo abrir: ' + r.motivo);
      return;
    }
    onAbierta();
  }

  return (
    <div style={{ border: '1px solid #ccc', padding: 20, maxWidth: 420 }}>
      <h3 style={{ marginTop: 0 }}>Abrir caja</h3>
      <p style={{ color: '#555' }}>
        La base inicial es el efectivo con el que arranca el cajón. Al cerrar se
        compara contra lo que cuentes.
      </p>
      <input type="number" placeholder="Base inicial" value={base}
             onChange={e => { setBase(e.target.value); setError(''); }} />
      {error && <p style={{ color: 'darkred' }}>{error}</p>}
      <br /><button onClick={abrir} disabled={abriendo} style={{ marginTop: 8 }}>
        {abriendo ? 'Abriendo...' : 'Abrir caja'}
      </button>
    </div>
  );
}

function NuevoMovimiento({ usuarioActual, onListo }) {
  const [tipo, setTipo] = useState('ingreso');
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function registrar() {
    const n = parseInt(monto, 10);
    if (!concepto.trim()) { setError('Escribe un concepto.'); return; }
    if (!n || n <= 0) { setError('El monto debe ser mayor que cero.'); return; }

    setGuardando(true);
    const r = await window.api.caja.registrarMovimiento({
      tipo, concepto: concepto.trim(), monto: n, usuarioId: usuarioActual.id,
    });
    setGuardando(false);
    if (!r.ok) { setError('No se pudo registrar: ' + r.motivo); return; }
    setConcepto(''); setMonto(''); setError('');
    onListo();
  }

  return (
    <div style={{ border: '1px solid #ccc', padding: 16, marginTop: 20, maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>Registrar movimiento de efectivo</h3>
      <select value={tipo} onChange={e => { setTipo(e.target.value); setError(''); }}>
        <option value="ingreso">Ingreso (entra al cajón)</option>
        <option value="egreso">Egreso (sale del cajón)</option>
      </select>
      <input placeholder="Concepto" value={concepto}
             onChange={e => { setConcepto(e.target.value); setError(''); }}
             style={{ marginLeft: 8, width: 240 }} />
      <input type="number" placeholder="Monto" value={monto}
             onChange={e => { setMonto(e.target.value); setError(''); }}
             style={{ marginLeft: 8, width: 110 }} />
      <button onClick={registrar} disabled={guardando} style={{ marginLeft: 8 }}>
        {guardando ? '...' : 'Registrar'}
      </button>
      {error && <p style={{ color: 'darkred', marginBottom: 0 }}>{error}</p>}
    </div>
  );
}

function CerrarCaja({ esperado, onCerrada, onCancelar }) {
  const [contado, setContado] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [cerrando, setCerrando] = useState(false);

  const n = contado === '' ? null : parseInt(contado, 10);
  const diferenciaPrevia = n === null || isNaN(n) ? null : n - esperado;

  async function cerrar() {
    if (n === null || isNaN(n) || n < 0) {
      setError('Escribe cuánto efectivo contaste.');
      return;
    }
    setCerrando(true);
    const r = await window.api.caja.cerrar({ efectivoContado: n, nota: nota.trim() || null });
    setCerrando(false);
    if (!r.ok) { setError('No se pudo cerrar: ' + r.motivo); return; }
    onCerrada(r);
  }

  return (
    <div style={{ border: '2px solid #333', padding: 16, marginTop: 20, maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>Cerrar caja</h3>
      <p>Según los movimientos, en el cajón debería haber <b>{pesos(esperado)}</b>.</p>

      <input type="number" placeholder="Efectivo contado" value={contado}
             onChange={e => { setContado(e.target.value); setError(''); }} />
      {diferenciaPrevia !== null && (
        <span style={{ marginLeft: 12 }}><Diferencia valor={diferenciaPrevia} /></span>
      )}

      <br /><input placeholder="Nota (opcional)" value={nota}
                   onChange={e => setNota(e.target.value)}
                   style={{ marginTop: 8, width: '100%' }} />

      {error && <p style={{ color: 'darkred' }}>{error}</p>}

      <button onClick={cerrar} disabled={cerrando} style={{ marginTop: 8 }}>
        {cerrando ? 'Cerrando...' : 'Cerrar caja'}
      </button>
      <button onClick={onCancelar} disabled={cerrando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}

export default function Caja({ usuarioActual }) {
  const [sesion, setSesion] = useState(undefined); // undefined = aún cargando
  const [resumen, setResumen] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [cerrando, setCerrando] = useState(false);
  const [ultimoCierre, setUltimoCierre] = useState(null);

  async function cargar() {
    const abierta = await window.api.caja.sesionAbierta();
    setSesion(abierta || null);
    setResumen(abierta ? await window.api.caja.resumen(abierta.id) : null);
    setHistorial(await window.api.caja.listarSesiones(15));
  }

  useEffect(() => { cargar(); }, []);

  if (sesion === undefined) return <p>Cargando...</p>;

  return (
    <div>
      <h1>Caja</h1>

      {ultimoCierre && (
        <div style={{ border: '1px solid darkgreen', padding: 12, marginBottom: 20, maxWidth: 560 }}>
          Caja cerrada. Esperado {pesos(ultimoCierre.esperado)}, contado{' '}
          {pesos(ultimoCierre.efectivoContado)}. <Diferencia valor={ultimoCierre.diferencia} />
        </div>
      )}

      {!sesion && <AbrirCaja usuarioActual={usuarioActual} onAbierta={() => { setUltimoCierre(null); cargar(); }} />}

      {sesion && resumen && (
        <>
          <div style={{ border: '1px solid #333', padding: 16, maxWidth: 560 }}>
            <p style={{ marginTop: 0 }}>
              Abierta por <b>{sesion.usuario_nombre}</b> el {fechaHora(sesion.abierta_en)}
            </p>
            <table>
              <tbody>
                <tr><td>Base inicial</td><td style={{ textAlign: 'right', paddingLeft: 20 }}>{pesos(sesion.base_inicial)}</td></tr>
                <tr><td>Ingresos</td><td style={{ textAlign: 'right', paddingLeft: 20 }}>+ {pesos(resumen.ingresos)}</td></tr>
                <tr><td>Egresos</td><td style={{ textAlign: 'right', paddingLeft: 20 }}>− {pesos(resumen.egresos)}</td></tr>
                <tr style={{ borderTop: '1px solid #333' }}>
                  <td><b>Debería haber</b></td>
                  <td style={{ textAlign: 'right', paddingLeft: 20 }}><b>{pesos(resumen.esperado)}</b></td>
                </tr>
              </tbody>
            </table>
            {!cerrando && (
              <button onClick={() => setCerrando(true)} style={{ marginTop: 12 }}>Cerrar caja</button>
            )}
          </div>

          {cerrando
            ? <CerrarCaja esperado={resumen.esperado}
                          onCerrada={(r) => { setCerrando(false); setUltimoCierre(r); cargar(); }}
                          onCancelar={() => setCerrando(false)} />
            : <NuevoMovimiento usuarioActual={usuarioActual} onListo={cargar} />}

          <h2 style={{ marginTop: 30 }}>Movimientos de esta caja</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 720 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
                <th>Hora</th><th>Concepto</th><th>Quién</th><th style={{ textAlign: 'right' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {resumen.movimientos.map(m => (
                <tr key={m.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{soloHora(m.fecha)}</td>
                  <td>{m.concepto}</td>
                  <td>{m.usuario_nombre || '—'}</td>
                  <td style={{ textAlign: 'right', color: m.tipo === 'egreso' ? 'darkred' : 'darkgreen' }}>
                    {m.tipo === 'egreso' ? '− ' : '+ '}{pesos(m.monto)}
                  </td>
                </tr>
              ))}
              {resumen.movimientos.length === 0 && (
                <tr><td colSpan={4} style={{ paddingTop: 12, color: '#777' }}>
                  Todavía no hay movimientos en esta caja.
                </td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      <h2 style={{ marginTop: 30 }}>Cajas anteriores</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 860 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Abierta</th><th>Cerrada</th><th>Quién</th>
            <th style={{ textAlign: 'right' }}>Base</th>
            <th style={{ textAlign: 'right' }}>Contado</th>
            <th>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {historial.filter(s => s.cerrada_en).map(s => (
            <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{fechaHora(s.abierta_en)}</td>
              <td>{fechaHora(s.cerrada_en)}</td>
              <td>{s.usuario_nombre}</td>
              <td style={{ textAlign: 'right' }}>{pesos(s.base_inicial)}</td>
              <td style={{ textAlign: 'right' }}>{pesos(s.efectivo_contado)}</td>
              <td><Diferencia valor={s.diferencia} />{s.nota ? <><br /><small style={{ color: '#888' }}>{s.nota}</small></> : null}</td>
            </tr>
          ))}
          {historial.filter(s => s.cerrada_en).length === 0 && (
            <tr><td colSpan={6} style={{ paddingTop: 12, color: '#777' }}>Todavía no se ha cerrado ninguna caja.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
