import { useState, useEffect, Fragment } from 'react';

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

// En un rango de varios dias la hora sola no dice nada: hacen falta el dia y el
// mes para saber a que jornada pertenece cada linea.
function fechaYHora(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' }) + ' ' + soloHora(iso);
}

const ORIGEN = {
  venta: { etiqueta: 'Venta', color: 'var(--acento-claro)' },
  membresia: { etiqueta: 'Membresía', color: 'var(--exito)' },
  manual: { etiqueta: 'Manual', color: 'var(--texto-tenue)' },
};

// Los movimientos del cajon no dicen a simple vista de donde vienen. La etiqueta
// lo dice, y con color distinto: 5.14 pide poder separar el mostrador de las
// membresias sin leer concepto por concepto.
function EtiquetaOrigen({ origen }) {
  const o = ORIGEN[origen] || ORIGEN.manual;
  return (
    <span style={{
      fontSize: 11, padding: '1px 8px', borderRadius: 999,
      border: '1px solid ' + o.color, color: o.color, whiteSpace: 'nowrap',
    }}>
      {o.etiqueta}
    </span>
  );
}

function Tarjeta({ titulo, extra, vacio, children }) {
  return (
    <div style={{
      background: 'var(--superficie)', border: '1px solid var(--borde-suave)',
      borderRadius: 'var(--radio)', padding: 14, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <h3 style={{ margin: 0 }}>{titulo}</h3>
        {extra}
      </div>
      {vacio ? <p style={{ color: 'var(--texto-tenue)', marginBottom: 0 }}>{vacio}</p> : children}
    </div>
  );
}

const MOTIVOS_ANULAR = {
  venta_no_existe: 'Esa venta ya no está.',
  ya_anulada: 'Esta venta ya estaba anulada.',
  sin_caja_abierta: 'Esta venta se cobró en efectivo, así que hay que sacar el dinero del cajón: abre la caja y vuelve a intentarlo.',
};

// Lo que llevaba una venta, y el boton para anularla. Se pide al desplegar y no
// con la lista, igual que el detalle de una caja cerrada.
//
// Anular no borra nada: devuelve el stock, saca del cajon SOLO la parte que
// entro en el -- lo de fuera de caja nunca estuvo ahi -- y deja la venta marcada
// con su motivo en auditoria. Por eso se pide confirmacion en dos pasos: es una
// operacion que mueve dinero y stock a la vez.
function DetalleVenta({ ventaId, usuarioActual, onAnulada }) {
  const [venta, setVenta] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    window.api.ventas.obtener(ventaId).then(v => { if (vigente) setVenta(v); });
    return () => { vigente = false; };
  }, [ventaId]);

  async function anular() {
    setError('');
    setEnviando(true);
    const r = await window.api.ventas.anular({
      ventaId,
      usuarioId: usuarioActual ? usuarioActual.id : null,
      motivo: motivo.trim() || null,
    });
    setEnviando(false);
    if (!r.ok) {
      setError(MOTIVOS_ANULAR[r.motivo] || 'No se pudo anular: ' + r.motivo);
      return;
    }
    onAnulada(r);
  }

  if (!venta) return <p style={{ color: 'var(--texto-tenue)', padding: 10 }}>Cargando...</p>;

  const hayFuera = venta.items.some(i => i.fuera_de_caja);

  return (
    <div style={{ padding: 10, background: 'var(--superficie-alta)', borderRadius: 'var(--radio)', margin: '6px 0 10px' }}
         onClick={e => e.stopPropagation()}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {venta.items.map(i => (
            <tr key={i.id}>
              <td style={{ width: 34, color: 'var(--texto-tenue)' }}>{i.cantidad}×</td>
              <td>
                {i.producto_nombre}
                {i.fuera_de_caja
                  ? <small style={{ color: 'var(--aviso)' }}> · fuera de caja</small>
                  : null}
              </td>
              <td style={{ textAlign: 'right' }}>{pesos(i.cantidad * i.p_unitario)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {venta.cliente_nombre && (
        <p style={{ fontSize: 12, color: 'var(--texto-suave)', margin: '8px 0 0' }}>
          A nombre de {venta.cliente_nombre}.
        </p>
      )}

      {!confirmando ? (
        <button type="button" onClick={() => setConfirmando(true)} style={{ marginTop: 10 }}>
          Anular venta
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--texto-suave)', marginTop: 0 }}>
            Vuelve el stock a la estantería y la venta queda marcada como anulada, no se borra.
            {venta.metodo_pago && MEDIOS_EN_CAJA.includes(String(venta.metodo_pago).toLowerCase()) && !hayFuera
              ? ' El efectivo sale del cajón con su egreso.'
              : ''}
            {hayFuera ? ' Del cajón solo sale lo que entró en él: lo de fuera de caja nunca estuvo ahí.' : ''}
          </p>
          <input placeholder="Motivo (opcional)" value={motivo}
                 onChange={e => { setMotivo(e.target.value); setError(''); }}
                 style={{ width: '100%', maxWidth: 320 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={anular} disabled={enviando}>
              {enviando ? 'Anulando...' : 'Confirmar anulación'}
            </button>
            <button type="button" onClick={() => { setConfirmando(false); setError(''); }} disabled={enviando}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p style={{ color: 'var(--error)', marginBottom: 0 }}>{error}</p>}
    </div>
  );
}

// Movimientos de una sesion ya cerrada. Se piden solo al desplegarla: cargar el
// detalle de las quince cajas del historial cada vez que se abre la pantalla
// seria traer cientos de filas que casi nunca se miran.
function DetalleSesion({ sesionId }) {
  const [detalle, setDetalle] = useState(null);

  useEffect(() => {
    let vigente = true;
    window.api.caja.resumen(sesionId).then(r => { if (vigente) setDetalle(r); });
    return () => { vigente = false; };
  }, [sesionId]);

  if (!detalle) return <p style={{ color: 'var(--texto-tenue)' }}>Cargando...</p>;
  if (detalle.movimientos.length === 0) {
    return <p style={{ color: 'var(--texto-tenue)' }}>Esta caja se cerró sin ningún movimiento.</p>;
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        {detalle.porOrigen.map(o => (
          <span key={o.origen} style={{ fontSize: 13 }}>
            <EtiquetaOrigen origen={o.origen} />{' '}
            <b>{pesos(o.ingresos - o.egresos)}</b>
          </span>
        ))}
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {detalle.movimientos.map(m => (
            <tr key={m.id} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
              <td style={{ width: 70 }}>{soloHora(m.fecha)}</td>
              <td style={{ width: 100 }}><EtiquetaOrigen origen={m.origen} /></td>
              <td>{m.concepto}</td>
              <td>{m.usuario_nombre || '—'}</td>
              <td style={{ textAlign: 'right', color: m.tipo === 'egreso' ? 'var(--error)' : 'var(--exito)' }}>
                {m.tipo === 'egreso' ? '− ' : '+ '}{pesos(m.monto)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Diferencia({ valor }) {
  if (valor === 0) return <b style={{ color: 'var(--exito)' }}>Cuadró exacto</b>;
  const falta = valor < 0;
  return (
    <b style={{ color: 'var(--error)' }}>
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
    <div style={{ border: '1px solid var(--borde)', padding: 20, maxWidth: 420 }}>
      <h3 style={{ marginTop: 0 }}>Abrir caja</h3>
      <p style={{ color: 'var(--texto-suave)' }}>
        La base inicial es el efectivo con el que arranca el cajón. Al cerrar se
        compara contra lo que cuentes.
      </p>
      <input type="number" placeholder="Base inicial" value={base}
             onChange={e => { setBase(e.target.value); setError(''); }} />
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
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
    <div style={{ border: '1px solid var(--borde)', padding: 16, marginTop: 20, maxWidth: 560 }}>
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
      {error && <p style={{ color: 'var(--error)', marginBottom: 0 }}>{error}</p>}
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
    <div style={{ border: '2px solid var(--borde-fuerte)', padding: 16, marginTop: 20, maxWidth: 560 }}>
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

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <button onClick={cerrar} disabled={cerrando} style={{ marginTop: 8 }}>
        {cerrando ? 'Cerrando...' : 'Cerrar caja'}
      </button>
      <button onClick={onCancelar} disabled={cerrando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}

// El backend devuelve dos listas por medio de pago (ventas y membresias). En
// pantalla interesa una sola tabla, con una fila por medio y las dos columnas.
const MEDIOS_EN_CAJA = ['efectivo'];

function mediosDelDia(ingresos) {
  const filas = new Map();
  const sumar = (lista, campo) => {
    for (const f of lista) {
      if (!filas.has(f.medio)) filas.set(f.medio, { medio: f.medio, ventas: 0, membresias: 0 });
      filas.get(f.medio)[campo] += f.monto;
    }
  };
  sumar(ingresos.ventas.porMedio, 'ventas');
  sumar(ingresos.membresias.porMedio, 'membresias');

  return [...filas.values()]
    .map(f => ({ ...f, total: f.ventas + f.membresias,
                 enCaja: MEDIOS_EN_CAJA.includes(String(f.medio).toLowerCase()) }))
    .sort((a, b) => b.total - a.total);
}

function hoyLocal() {
  const d = new Date();
  return [d.getFullYear(),
          String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0')].join('-');
}

// Se resta con setDate() y no restando milisegundos, que se equivoca en los dos
// dias del año en que cambia el horario de verano.
function haceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return [d.getFullYear(),
          String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0')].join('-');
}

export default function Caja({ usuarioActual }) {
  const [sesion, setSesion] = useState(undefined); // undefined = aún cargando
  const [resumen, setResumen] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [cerrando, setCerrando] = useState(false);
  const [ultimoCierre, setUltimoCierre] = useState(null);
  const [fuera, setFuera] = useState(null);
  const [ingresos, setIngresos] = useState(null);
  const [ventasHoy, setVentasHoy] = useState([]);
  const [pagosHoy, setPagosHoy] = useState(null);
  const [sesionAbiertaEnHistorial, setSesionAbiertaEnHistorial] = useState(null);
  const [ventaAbierta, setVentaAbierta] = useState(null);
  const [avisoVenta, setAvisoVenta] = useState('');
  // Lo de fuera de caja es lo unico de esta pantalla que se puede mirar de
  // otros dias: no tiene arqueo que cuadrar, asi que un rango no descuadra
  // nada. El resto sigue siendo de hoy.
  const [desde, setDesde] = useState(hoyLocal);
  const [hasta, setHasta] = useState(hoyLocal);

  async function cargarFuera(d, h) {
    setFuera(await window.api.ventas.fueraDeCajaEntre(d, h));
  }

  async function cargar() {
    const hoy = hoyLocal();
    const abierta = await window.api.caja.sesionAbierta();
    setSesion(abierta || null);
    setResumen(abierta ? await window.api.caja.resumen(abierta.id) : null);
    setHistorial(await window.api.caja.listarSesiones(15));
    // Estos tres van por dia y no por sesion de caja: el dinero que entra por
    // Nequi o tarjeta no pasa por el cajon, y aun asi es dinero del dia.
    setIngresos(await window.api.dashboard.ingresosDelDia(hoy));
    setVentasHoy(await window.api.ventas.listarDelDia(hoy));
    setPagosHoy(await window.api.membresias.pagosDelDia(hoy));
  }

  useEffect(() => { cargar(); }, []);
  // Lo de fuera va por su cuenta y no dentro de cargar(): asi se recarga solo
  // al mover el rango, y una sola vez al entrar. Un boton "Buscar" seria un
  // clic de mas para lo unico que hace esta caja.
  useEffect(() => { cargarFuera(desde, hasta); }, [desde, hasta]);

  if (sesion === undefined) return <p>Cargando...</p>;

  const ventasVivas = ventasHoy.filter(v => !v.anulada);
  const totalVentasHoy = ventasVivas.reduce((s, v) => s + v.total, 0);

  return (
    <div>
      <h1>Caja</h1>

      {ultimoCierre && (
        <div style={{ border: '1px solid var(--exito)', padding: 12, marginBottom: 20, maxWidth: 560 }}>
          Caja cerrada. Esperado {pesos(ultimoCierre.esperado)}, contado{' '}
          {pesos(ultimoCierre.efectivoContado)}. <Diferencia valor={ultimoCierre.diferencia} />
        </div>
      )}

      {!sesion && <AbrirCaja usuarioActual={usuarioActual} onAbierta={() => { setUltimoCierre(null); cargar(); }} />}

      {sesion && resumen && (
        <>
          <div style={{ border: '1px solid var(--borde-fuerte)', padding: 16, maxWidth: 560 }}>
            <p style={{ marginTop: 0 }}>
              Abierta por <b>{sesion.usuario_nombre}</b> el {fechaHora(sesion.abierta_en)}
            </p>
            <table>
              <tbody>
                <tr><td>Base inicial</td><td style={{ textAlign: 'right', paddingLeft: 20 }}>{pesos(sesion.base_inicial)}</td></tr>
                <tr><td>Ingresos</td><td style={{ textAlign: 'right', paddingLeft: 20 }}>+ {pesos(resumen.ingresos)}</td></tr>
                <tr><td>Egresos</td><td style={{ textAlign: 'right', paddingLeft: 20 }}>− {pesos(resumen.egresos)}</td></tr>
                <tr style={{ borderTop: '1px solid var(--borde-fuerte)' }}>
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

          <h3 style={{ marginTop: 24, marginBottom: 8 }}>De dónde salió el dinero del cajón</h3>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 8 }}>
            {(resumen.porOrigen || []).map(o => (
              <div key={o.origen} style={{
                border: '1px solid var(--borde-suave)', borderRadius: 'var(--radio)',
                padding: '8px 14px', minWidth: 150,
              }}>
                <EtiquetaOrigen origen={o.origen} />
                <div style={{ fontSize: 18, marginTop: 4 }}><b>{pesos(o.ingresos - o.egresos)}</b></div>
                {o.egresos > 0 && (
                  <small style={{ color: 'var(--texto-tenue)' }}>
                    {pesos(o.ingresos)} − {pesos(o.egresos)} devueltos
                  </small>
                )}
              </div>
            ))}
            {(resumen.porOrigen || []).length === 0 && (
              <p style={{ color: 'var(--texto-tenue)', margin: 0 }}>Todavía no ha entrado ni salido nada.</p>
            )}
          </div>

          <h2 style={{ marginTop: 30 }}>Movimientos de esta caja</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 720 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--borde-fuerte)' }}>
                <th>Hora</th><th>Origen</th><th>Concepto</th><th>Quién</th><th style={{ textAlign: 'right' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {resumen.movimientos.map(m => (
                <tr key={m.id} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                  <td>{soloHora(m.fecha)}</td>
                  <td><EtiquetaOrigen origen={m.origen} /></td>
                  <td>{m.concepto}</td>
                  <td>{m.usuario_nombre || '—'}</td>
                  <td style={{ textAlign: 'right', color: m.tipo === 'egreso' ? 'var(--error)' : 'var(--exito)' }}>
                    {m.tipo === 'egreso' ? '− ' : '+ '}{pesos(m.monto)}
                  </td>
                </tr>
              ))}
              {resumen.movimientos.length === 0 && (
                <tr><td colSpan={5} style={{ paddingTop: 12, color: 'var(--texto-tenue)' }}>
                  Todavía no hay movimientos en esta caja.
                </td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {/* Todo el dinero del dia, no solo el del cajon. El arqueo cuenta el
          efectivo; lo cobrado por Nequi, tarjeta o transferencia entra igual al
          negocio aunque no pase por el cajón, y hasta ahora no se veia en
          ninguna parte de esta pantalla. */}
      {ingresos && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1.3fr) minmax(300px, 1fr)',
                      gap: 20, alignItems: 'start', marginTop: 20 }}>
          <Tarjeta
            titulo="Ingresos de hoy por medio de pago"
            extra={<b style={{ fontSize: 18 }}>{pesos(ingresos.total)}</b>}
            vacio={ingresos.total === 0 ? 'Todavia no ha entrado dinero hoy.' : null}
          >
            <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 8 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--borde-fuerte)' }}>
                  <th>Medio</th>
                  <th style={{ textAlign: 'right' }}>Ventas</th>
                  <th style={{ textAlign: 'right' }}>Membresías</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {mediosDelDia(ingresos).map(m => (
                  <tr key={m.medio} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                    <td>
                      {m.medio}
                      {m.enCaja && <><br /><small style={{ color: 'var(--texto-tenue)' }}>entra al cajón</small></>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{m.ventas ? pesos(m.ventas) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{m.membresias ? pesos(m.membresias) : '—'}</td>
                    <td style={{ textAlign: 'right' }}><b>{pesos(m.total)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tarjeta>

          <div>
            <Tarjeta
              titulo={'Ventas de productos (' + ventasVivas.length + ')'}
              extra={<b>{pesos(totalVentasHoy)}</b>}
              vacio={ventasVivas.length === 0 ? 'Hoy no se ha vendido ningún producto.' : null}
            >
              {/* Cada venta se despliega para ver que llevaba y, si hace falta,
                  anularla. Antes esta lista solo decia hora, numero y total: si
                  el mostrador cobraba el producto equivocado no habia forma de
                  arreglarlo desde la app, aunque la base si sabia hacerlo. */}
              <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 8 }}>
                <tbody>
                  {ventasVivas.map(v => (
                    <Fragment key={v.id}>
                      <tr onClick={() => setVentaAbierta(id => (id === v.id ? null : v.id))}
                          style={{ borderBottom: '1px solid var(--borde-suave)', cursor: 'pointer' }}>
                        <td style={{ width: 62 }}>{soloHora(v.fecha)}</td>
                        <td>#{v.id}<br /><small style={{ color: 'var(--texto-tenue)' }}>{v.metodo_pago}</small></td>
                        <td style={{ textAlign: 'right' }}>{pesos(v.total)}</td>
                        <td style={{ width: 18, textAlign: 'right', color: 'var(--acento-claro)' }}>
                          {ventaAbierta === v.id ? '▾' : '▸'}
                        </td>
                      </tr>
                      {ventaAbierta === v.id && (
                        <tr>
                          <td colSpan={4} style={{ padding: 0 }}>
                            <DetalleVenta
                              ventaId={v.id}
                              usuarioActual={usuarioActual}
                              onAnulada={(r) => {
                                setVentaAbierta(null);
                                setAvisoVenta('Venta #' + r.ventaId + ' anulada. Se devolvió el stock'
                                  + (r.devuelto > 0 ? ' y salieron ' + pesos(r.devuelto) + ' del cajón.' : '.'));
                                cargar();
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>

              {avisoVenta && (
                <p style={{ color: 'var(--exito)', marginBottom: 0, marginTop: 10 }}>{avisoVenta}</p>
              )}
            </Tarjeta>

            <Tarjeta
              titulo={'Membresías cobradas (' + (pagosHoy ? pagosHoy.pagos.length : 0) + ')'}
              extra={<b>{pesos(pagosHoy ? pagosHoy.total : 0)}</b>}
              vacio={!pagosHoy || pagosHoy.pagos.length === 0 ? 'Hoy no se ha cobrado ninguna membresía.' : null}
            >
              <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 8 }}>
                <tbody>
                  {(pagosHoy ? pagosHoy.pagos : []).map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                      <td style={{ width: 62 }}>{soloHora(p.fecha)}</td>
                      <td>
                        {p.cliente_nombre}
                        <br /><small style={{ color: 'var(--texto-tenue)' }}>{p.plan_nombre} · {p.metodo}</small>
                      </td>
                      <td style={{ textAlign: 'right' }}>{pesos(p.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tarjeta>
          </div>
        </div>
      )}

      {/* Lo vendido que no es del gimnasio. Va aparte a proposito: no entra en
          el arqueo ni tiene apertura ni cierre, solo se registra para poder
          mirarlo. Se muestra aunque no haya caja abierta, porque estas ventas se
          pueden hacer igual sin ella.

          Es la unica parte de esta pantalla con rango de fechas: al no tocar el
          arqueo, mirar la semana pasada no descuadra nada. Cuando el rango pasa
          de un dia la lista de lineas deja de ser legible, y lo que se lee es el
          total por producto. */}
      {fuera && (
        <div style={{
          border: '1px solid ' + (fuera.total > 0 ? 'var(--aviso)' : 'var(--borde-suave)'),
          background: fuera.total > 0 ? 'var(--aviso-fondo)' : 'transparent',
          borderRadius: 'var(--radio)', padding: 14, marginTop: 20, maxWidth: 720,
        }}>
          <h3 style={{ marginTop: 0 }}>
            Fuera de caja: {pesos(fuera.total)} ({fuera.unidades} {fuera.unidades === 1 ? 'unidad' : 'unidades'})
          </h3>
          <p style={{ fontSize: 12, color: 'var(--texto-suave)', marginTop: 0 }}>
            No suma a las ventas del gimnasio ni al arqueo. Este dinero se guarda aparte.
          </p>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Desde
              <input type="date" value={desde} max={hasta}
                     onChange={e => setDesde(e.target.value)} style={{ marginLeft: 6 }} />
            </label>
            <label style={{ fontSize: 13 }}>Hasta
              <input type="date" value={hasta} min={desde} max={hoyLocal()}
                     onChange={e => setHasta(e.target.value)} style={{ marginLeft: 6 }} />
            </label>
            <button type="button" onClick={() => { setDesde(hoyLocal()); setHasta(hoyLocal()); }}>Hoy</button>
            <button type="button" onClick={() => { setDesde(haceDias(6)); setHasta(hoyLocal()); }}>7 días</button>
            <button type="button" onClick={() => { setDesde(haceDias(29)); setHasta(hoyLocal()); }}>30 días</button>
          </div>

          {fuera.lineas.length === 0 ? (
            <p style={{ color: 'var(--texto-tenue)', margin: 0 }}>
              No se vendió nada de fuera de caja en estas fechas.
            </p>
          ) : (
            <>
              {desde !== hasta && (
                <>
                <h4 style={{ margin: '0 0 6px' }}>Por producto</h4>
                <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 20 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--borde-fuerte)' }}>
                      <th>Producto</th>
                      <th style={{ textAlign: 'right' }}>Unidades</th>
                      <th style={{ textAlign: 'right' }}>Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fuera.porProducto.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                        <td>{p.nombre}</td>
                        <td style={{ textAlign: 'right' }}>{p.unidades}</td>
                        <td style={{ textAlign: 'right' }}>{pesos(p.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h4 style={{ margin: '0 0 6px' }}>Venta por venta</h4>
                </>
              )}

              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--borde-fuerte)' }}>
                    <th>Fecha</th><th>Producto</th><th style={{ textAlign: 'right' }}>Cant.</th>
                    <th>Medio</th><th style={{ textAlign: 'right' }}>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {fuera.lineas.map(l => (
                    <tr key={l.id} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                      <td>{desde === hasta ? soloHora(l.fecha) : fechaYHora(l.fecha)}</td>
                      <td>{l.producto_nombre}</td>
                      <td style={{ textAlign: 'right' }}>{l.cantidad}</td>
                      <td>{l.metodo_pago}</td>
                      <td style={{ textAlign: 'right' }}>{pesos(l.cantidad * l.p_unitario)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* El total de arriba SI cuenta las lineas que no caben: se
                  calcula en la base sobre el rango entero. */}
              {fuera.truncado && (
                <p style={{ fontSize: 12, color: 'var(--texto-suave)', marginBottom: 0 }}>
                  Se muestran las {fuera.lineas.length} ventas más recientes del rango.
                  El total de arriba sí incluye todas.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <h2 style={{ marginTop: 30 }}>Cajas anteriores</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 860 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--borde-fuerte)' }}>
            <th></th><th>Abierta</th><th>Cerrada</th><th>Quién</th>
            <th style={{ textAlign: 'right' }}>Base</th>
            <th style={{ textAlign: 'right' }}>Contado</th>
            <th>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {historial.filter(s => s.cerrada_en).map(s => {
            const abierta = sesionAbiertaEnHistorial === s.id;
            return (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                <td colSpan={7} style={{ padding: 0 }}>
                  <div
                    onClick={() => setSesionAbiertaEnHistorial(abierta ? null : s.id)}
                    style={{ display: 'grid', gridTemplateColumns: '24px 1.2fr 1.2fr 1fr 0.8fr 0.8fr 1.4fr',
                             alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 0' }}
                  >
                    <span style={{ color: 'var(--acento-claro)' }}>{abierta ? '▾' : '▸'}</span>
                    <span>{fechaHora(s.abierta_en)}</span>
                    <span>{fechaHora(s.cerrada_en)}</span>
                    <span>{s.usuario_nombre}</span>
                    <span style={{ textAlign: 'right' }}>{pesos(s.base_inicial)}</span>
                    <span style={{ textAlign: 'right' }}>{pesos(s.efectivo_contado)}</span>
                    <span>
                      <Diferencia valor={s.diferencia} />
                      {s.nota ? <><br /><small style={{ color: 'var(--texto-tenue)' }}>{s.nota}</small></> : null}
                    </span>
                  </div>
                  {abierta && (
                    <div style={{ padding: '10px 0 16px 24px' }}>
                      <DetalleSesion sesionId={s.id} />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {historial.filter(s => s.cerrada_en).length === 0 && (
            <tr><td colSpan={7} style={{ paddingTop: 12, color: 'var(--texto-tenue)' }}>Todavía no se ha cerrado ninguna caja.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
