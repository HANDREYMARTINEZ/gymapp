import { useState, useEffect } from 'react';
import VenderMembresiaForm from './VenderMembresiaForm';
import RenovarMembresiaForm from './RenovarMembresiaForm';
import EliminarMembresiaForm from './EliminarMembresiaForm';
import RegistrarPagoForm from './RegistrarPagoForm';
import BotonVolver from '../components/BotonVolver';
import CobrarDeuda from '../components/CobrarDeuda';

// Fondos de etiqueta con letra clara encima: todos oscuros. "Programada" va en
// oro apagado, no en el amarillo de la marca, que dejaria el texto ilegible.
const COLOR_ESTADO = {
  activa: 'var(--exito-solido)',
  por_vencer: 'var(--aviso-solido)',
  programada: 'var(--acento-profundo)',
  vencida: 'var(--error-solido)',
  agotada: 'var(--error-solido)',
  pausada: 'var(--neutro-solido)',
  saldo_pendiente: 'var(--aviso-solido)',
  anulada: 'var(--neutro-solido)',
};

const LABEL_ESTADO = {
  activa: 'Activa',
  por_vencer: 'Por vencer',
  programada: 'Programada',
  vencida: 'Vencida',
  agotada: 'Agotada',
  pausada: 'Pausada',
  saldo_pendiente: 'Saldo pendiente',
  anulada: 'Anulada',
};

// El historial de un cliente antiguo puede tener decenas de membresias, y todas
// menos una son papel viejo. Estas son las que siguen contando para algo; el
// resto se esconde detras del boton de historial.
const VIGENTES = ['activa', 'por_vencer', 'programada', 'pausada', 'saldo_pendiente'];

export default function ClienteFicha({ clienteId, usuarioActual, onEditar, onVolver }) {
  const [cliente, setCliente] = useState(null);
  const [membresias, setMembresias] = useState([]);
  const [expandidaId, setExpandidaId] = useState(null);
  const [pagosPorMembresia, setPagosPorMembresia] = useState({});
  const [pausasPorMembresia, setPausasPorMembresia] = useState({});
  const [mostrarVender, setMostrarVender] = useState(false);
  const [mostrarPagoId, setMostrarPagoId] = useState(null);
  const [mostrarPausaId, setMostrarPausaId] = useState(null);
  const [mostrarRenovarId, setMostrarRenovarId] = useState(null);
  const [mostrarEliminarId, setMostrarEliminarId] = useState(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [motivoPausa, setMotivoPausa] = useState('');
  const [mostrarBaja, setMostrarBaja] = useState(false);
  const [motivoBaja, setMotivoBaja] = useState('');
  // Tiquetes: que membresia tiene el panel abierto, cuantos se anaden o quitan
  // y por que. El motivo no es obligatorio, pero queda en auditoria.
  const [mostrarTicketsId, setMostrarTicketsId] = useState(null);
  const [deltaTickets, setDeltaTickets] = useState('');
  const [motivoTickets, setMotivoTickets] = useState('');
  const [avisoTickets, setAvisoTickets] = useState(null);
  // Lo que debe en total (membresias con saldo y fiados de la tienda).
  const [cuenta, setCuenta] = useState(null);
  const [cobrando, setCobrando] = useState(false);

  // Las que siguen contando para algo. Es el mismo criterio que usa el backend
  // al anotar la baja en auditoria, y lo que se le avisa antes de confirmarla.
  const vivas = membresias.filter(m => VIGENTES.includes(m.estado)).length;

  // Anadir (delta positivo) o quitar (negativo) tiquetes de una ticketera ya
  // vendida, sin tocar nada mas de la membresia.
  async function ajustarTickets(membresiaId, signo) {
    const cantidad = parseInt(deltaTickets, 10);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      setAvisoTickets({ ok: false, motivo: 'cantidad_invalida' });
      return;
    }
    const r = await window.api.membresias.ajustarTickets({
      membresiaId, delta: signo * cantidad, motivo: motivoTickets,
      usuarioId: usuarioActual ? usuarioActual.id : null,
    });
    setAvisoTickets(r);
    if (r.ok) {
      setDeltaTickets('');
      setMotivoTickets('');
      cargar();
    }
  }

  async function confirmarBaja() {
    await window.api.clientes.darDeBaja({
      clienteId, usuarioId: usuarioActual ? usuarioActual.id : null, motivo: motivoBaja,
    });
    setMostrarBaja(false);
    setMotivoBaja('');
    cargar();
  }

  async function confirmarReactivar() {
    await window.api.clientes.reactivar({
      clienteId, usuarioId: usuarioActual ? usuarioActual.id : null,
    });
    cargar();
  }

  async function cargar() {
    const c = await window.api.clientes.obtener(clienteId);
    setCliente(c);
    const m = await window.api.membresias.listarPorCliente(clienteId);
    setMembresias(m);
    setCuenta(await window.api.fiados.cuenta(clienteId));
    setPagosPorMembresia({});
    setPausasPorMembresia({});
  }

  useEffect(() => { cargar(); }, [clienteId]);

  function cerrarPaneles() {
    setMostrarPagoId(null);
    setMostrarPausaId(null);
    setMostrarRenovarId(null);
    setMostrarEliminarId(null);
    setMotivoPausa('');
    setMostrarTicketsId(null);
    setDeltaTickets('');
    setMotivoTickets('');
    setAvisoTickets(null);
    setMostrarBaja(false);
    setCobrando(false);
  }

  async function expandir(membresiaId) {
    if (expandidaId === membresiaId) {
      setExpandidaId(null);
      return;
    }
    setExpandidaId(membresiaId);
    const pagos = await window.api.membresias.listarPagos(membresiaId);
    setPagosPorMembresia(prev => ({ ...prev, [membresiaId]: pagos }));
    const pausas = await window.api.pausas.listarPorMembresia(membresiaId);
    setPausasPorMembresia(prev => ({ ...prev, [membresiaId]: pausas }));
  }

  async function confirmarPausa(membresiaId) {
    await window.api.pausas.pausar({ membresiaId, motivo: motivoPausa, usuarioId: usuarioActual.id });
    cerrarPaneles();
    cargar();
  }

  async function reactivar(membresiaId) {
    await window.api.pausas.reactivar(membresiaId);
    cargar();
  }

  function despuesDeVender() {
    setMostrarVender(false);
    cargar();
  }

  function despuesDeCambio() {
    cerrarPaneles();
    cargar();
  }

  if (!cliente) return <p>Cargando...</p>;

  const vigentes = membresias.filter(m => VIGENTES.includes(m.estado));
  const historial = membresias.filter(m => !VIGENTES.includes(m.estado));
  // Si no queda ninguna vigente, se muestra igual la ultima: dejar el bloque
  // vacio cuando el cliente si tuvo membresias engana mas que informar.
  const arriba = vigentes.length > 0 ? vigentes : membresias.slice(0, 1);
  const abajo = historial.filter(m => !arriba.includes(m));

  function tarjeta(m) {
    return (
      <div key={m.id} style={{ border: '1px solid var(--borde-suave)', borderRadius: 'var(--radio)', marginBottom: 10, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: 12 }} onClick={() => expandir(m.id)}>
          <div>
            <b>{m.plan_nombre}</b>{' '}
            ({m.plan_tipo === 'periodo'
              ? `${m.f_inicio} → ${m.f_fin}`
              : `${m.tickets_totales - m.tickets_usados} de ${m.tickets_totales} tickets`})
          </div>
          <span style={{ color: 'var(--texto)', background: COLOR_ESTADO[m.estado] || 'var(--neutro-solido)', padding: '2px 10px', borderRadius: 12, fontSize: 12, whiteSpace: 'nowrap' }}>
            {LABEL_ESTADO[m.estado] || m.estado}
          </span>
        </div>

        {m.estado === 'programada' && (
          <p style={{ color: 'var(--acento-claro)', marginBottom: 0, fontSize: 13 }}>
            Todavía no empieza. El cliente no podrá entrar hasta el {m.f_inicio}.
          </p>
        )}

        {m.saldoPendiente > 0 && (
          <p style={{ color: 'var(--aviso)', marginBottom: 0 }}>
            Saldo pendiente: ${m.saldoPendiente.toLocaleString('es-CO')}
            {m.anulada === 0 && (m.fiado_hasta
              ? (m.estado === 'saldo_pendiente'
                  ? <span style={{ color: 'var(--error)' }}> · fiada hasta el {m.fiado_hasta}: ya pasó la fecha, no puede entrar</span>
                  : <span> · fiada hasta el {m.fiado_hasta}: puede entrar hasta ese día</span>)
              : <span> · sin fiar: no puede entrar hasta que pague o se le fíe</span>)}
          </p>
        )}

        {m.anulada === 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {m.saldoPendiente > 0 && (
              <button onClick={(e) => { e.stopPropagation(); const abrir = mostrarPagoId !== m.id; cerrarPaneles(); setMostrarPagoId(abrir ? m.id : null); }}>
                Registrar pago / fiar
              </button>
            )}
            {m.estado === 'pausada'
              ? <button onClick={(e) => { e.stopPropagation(); reactivar(m.id); }}>Reactivar</button>
              : <button onClick={(e) => { e.stopPropagation(); const abrir = mostrarPausaId !== m.id; cerrarPaneles(); setMostrarPausaId(abrir ? m.id : null); }}>Pausar</button>
            }
            {/* Solo para ticketeras: en una de periodo no hay nada que ajustar. */}
            {m.plan_tipo === 'ticketera' && (
              <button onClick={(e) => { e.stopPropagation(); const abrir = mostrarTicketsId !== m.id; cerrarPaneles(); setMostrarTicketsId(abrir ? m.id : null); }}>
                Tiquetes
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); const abrir = mostrarRenovarId !== m.id; cerrarPaneles(); setMostrarRenovarId(abrir ? m.id : null); }}>
              Renovar
            </button>
            <button onClick={(e) => { e.stopPropagation(); const abrir = mostrarEliminarId !== m.id; cerrarPaneles(); setMostrarEliminarId(abrir ? m.id : null); }}>
              Eliminar
            </button>
          </div>
        )}

        {mostrarPausaId === m.id && (
          <div style={{ marginTop: 8, padding: 8, background: 'var(--superficie-alta)', borderRadius: 'var(--radio)' }} onClick={e => e.stopPropagation()}>
            <input placeholder="Motivo de la pausa (opcional)" value={motivoPausa} onChange={e => setMotivoPausa(e.target.value)} />
            <button onClick={() => confirmarPausa(m.id)} style={{ marginLeft: 8 }}>Confirmar pausa</button>
            <button onClick={cerrarPaneles} style={{ marginLeft: 8 }}>Cancelar</button>
          </div>
        )}

        {mostrarTicketsId === m.id && (
          <div style={{ marginTop: 8, padding: 10, background: 'var(--superficie-alta)',
                        borderRadius: 'var(--radio)' }} onClick={e => e.stopPropagation()}>
            <div style={{ marginBottom: 8 }}>
              <b>{m.tickets_totales - m.tickets_usados} tiquetes disponibles</b>
              <span style={{ color: 'var(--texto-tenue)' }}>
                {' '}&mdash; {m.tickets_usados} usados de {m.tickets_totales}
              </span>
            </div>
            {/* Los usados no se editan aqui: cada uno corresponde a una entrada
                registrada. Lo que se ajusta es cuantos tiene comprados. */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="number" min="1" placeholder="Cuántos" value={deltaTickets}
                     onChange={e => { setDeltaTickets(e.target.value); setAvisoTickets(null); }}
                     style={{ width: 90 }} />
              <button onClick={() => ajustarTickets(m.id, 1)}>Añadir</button>
              <button onClick={() => ajustarTickets(m.id, -1)}>Quitar</button>
              <input placeholder="Motivo (opcional)" value={motivoTickets}
                     onChange={e => setMotivoTickets(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
            </div>
            {avisoTickets && !avisoTickets.ok && (
              <p style={{ color: 'var(--error)', marginBottom: 0 }}>
                {avisoTickets.motivo === 'quedaria_en_negativo'
                  ? 'No puede quitar tantos: solo quedan ' + avisoTickets.disponiblesAhora + ' disponibles.'
                  : avisoTickets.motivo === 'cantidad_invalida'
                    ? 'Escriba cuántos tiquetes, en número entero.'
                    : 'No se pudo ajustar: ' + avisoTickets.motivo}
              </p>
            )}
            {avisoTickets && avisoTickets.ok && (
              <p style={{ color: 'var(--exito)', marginBottom: 0 }}>
                Listo: {avisoTickets.disponibles} disponibles de {avisoTickets.totales}.
              </p>
            )}
            <button onClick={cerrarPaneles} style={{ marginTop: 8 }}>Cerrar</button>
          </div>
        )}

        {mostrarPagoId === m.id && (
          <RegistrarPagoForm membresiaId={m.id} fInicioActual={m.f_inicio} usuarioActual={usuarioActual}
                             saldo={m.saldoPendiente} fiadoHastaActual={m.fiado_hasta}
                             onGuardado={despuesDeCambio} onCancelar={cerrarPaneles} />
        )}

        {mostrarRenovarId === m.id && (
          <RenovarMembresiaForm membresia={m} usuarioActual={usuarioActual}
                                onRenovado={despuesDeCambio} onCancelar={cerrarPaneles} />
        )}

        {mostrarEliminarId === m.id && (
          <EliminarMembresiaForm membresia={m} pagado={m.pagadoEfectivo} usuarioActual={usuarioActual}
                                 onEliminada={despuesDeCambio} onCancelar={cerrarPaneles} />
        )}

        {expandidaId === m.id && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--borde-suave)' }}>
            <p>Precio acordado: ${m.precio_pagado.toLocaleString('es-CO')} {m.descuento > 0 && `(descuento ${m.descuento}%)`}</p>

            <h4>Pagos</h4>
            {(pagosPorMembresia[m.id] || []).length === 0 && <p>Sin pagos registrados.</p>}
            <ul>
              {(pagosPorMembresia[m.id] || []).map(p => (
                <li key={p.id} style={{ textDecoration: p.anulada ? 'line-through' : 'none' }}>
                  ${p.monto.toLocaleString('es-CO')} — {p.metodo} — {p.fecha.slice(0, 10)} {p.nota && `(${p.nota})`}
                </li>
              ))}
            </ul>

            <h4>Pausas</h4>
            {(pausasPorMembresia[m.id] || []).length === 0 && <p>Sin pausas registradas.</p>}
            <ul>
              {(pausasPorMembresia[m.id] || []).map(p => (
                <li key={p.id}>
                  {p.f_inicio} → {p.f_fin || 'en curso'} {p.motivo && `(${p.motivo})`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <BotonVolver onClick={onVolver} texto="← Volver a la lista" />
      <h1 style={{ marginBottom: 4 }}>{cliente.nombre}</h1>
      <p style={{ color: 'var(--texto-suave)', marginTop: 0 }}>
        {cliente.documento || 'sin documento'} — {cliente.telefono || 'sin teléfono'} — {cliente.email || 'sin email'}
      </p>

      {/* El aviso vive en la ficha y no solo en el kiosco porque es aqui donde se
          arregla: se entra a esta pantalla para tomarle la huella, ponerle el PIN
          o venderle una membresia, y en cualquiera de esos momentos conviene
          acordarse de pedirle la cedula. */}
      {cliente.documento_provisional === 1 && (
        <div style={{
          margin: '10px 0 14px', padding: '10px 14px', maxWidth: 620,
          background: 'var(--aviso-fondo)', border: '1px solid var(--aviso)',
          borderRadius: 'var(--radio)', color: 'var(--aviso)',
        }}>
          <b>{'\u26A0'} Este cliente todavía no tiene documento.</b> Entró desde el
          Excel sin cédula, así que la app le puso una provisional
          (<code>{cliente.documento}</code>) para que pueda usar el kiosco. Cuando
          te dé la real, escríbela en "Editar datos del cliente" y este aviso
          desaparece solo.
        </div>
      )}

      {/* Dar de baja no borra nada: apaga el interruptor que la app ya respetaba
          en todas partes. Se pone aqui, en la ficha, y no en la lista: para darle
          de baja hay que haber entrado a mirar a quien se le esta dando. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => onEditar(cliente)}>Editar datos del cliente</button>
        {cliente.activo === 1 ? (
          <button onClick={() => { cerrarPaneles(); setMostrarBaja(v => !v); }}>
            Dar de baja
          </button>
        ) : (
          <button onClick={confirmarReactivar}>Volver a dar de alta</button>
        )}
      </div>

      {cliente.activo === 0 && (
        <div style={{ margin: '12px 0', padding: '10px 14px', maxWidth: 620,
                      background: 'var(--superficie-alta)', border: '1px solid var(--borde-fuerte)',
                      borderRadius: 'var(--radio)', color: 'var(--texto-suave)' }}>
          <b>Este cliente está dado de baja.</b> No sale en las búsquedas, no cuenta
          para los recordatorios y no puede entrar por el kiosco. Su historial está
          intacto y vuelve entero al darle de alta.
        </div>
      )}

      {mostrarBaja && (
        <div style={{ margin: '12px 0', padding: 14, maxWidth: 620,
                      border: '1px solid var(--aviso)', background: 'var(--aviso-fondo)',
                      borderRadius: 'var(--radio)' }}>
          <p style={{ marginTop: 0 }}>
            ¿Dar de baja a <b>{cliente.nombre}</b>?
          </p>
          {/* Lo que se lleva y lo que no, dicho antes y no despues. */}
          <p style={{ marginTop: 0 }}>
            Deja de salir en las búsquedas, en el censo de correos y en los
            recordatorios, y el kiosco no le deja entrar. <b>No se borra nada</b>:
            sus membresías, pagos y asistencias siguen ahí, y puedes volver a darle
            de alta cuando quieras.
          </p>
          {vivas > 0 && (
            <p style={{ color: 'var(--aviso)' }}>
              {'⚠'} Tiene <b>{vivas}</b> {vivas === 1 ? 'membresía que sigue viva' : 'membresías que siguen vivas'}.
              Darle de baja no le devuelve el dinero ni anula nada; simplemente deja
              de poder entrar.
            </p>
          )}
          <input placeholder="Motivo (opcional)" value={motivoBaja}
                 onChange={e => setMotivoBaja(e.target.value)} style={{ width: '100%', maxWidth: 380 }} />
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button onClick={confirmarBaja}>Sí, dar de baja</button>
            <button onClick={() => { setMostrarBaja(false); setMotivoBaja(''); }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* La cuenta del cliente: todo lo que debe junto, membresias y tienda. */}
      {cuenta && cuenta.total > 0 && (
        <div style={{ margin: '16px 0 0', padding: '10px 14px', maxWidth: 620,
                      border: '1px solid ' + (cuenta.vencido ? 'var(--error)' : 'var(--aviso)'),
                      background: 'var(--aviso-fondo)', borderRadius: 'var(--radio)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <b>Debe ${cuenta.total.toLocaleString('es-CO')}</b>
              <span style={{ color: 'var(--texto-suave)', fontSize: 13 }}>
                {' '}en {cuenta.items.length} {cuenta.items.length === 1 ? 'cuenta' : 'cuentas'}
                {cuenta.vencido ? ' · hay algo vencido' : ''}
              </span>
            </div>
            {!cobrando && <button onClick={() => { cerrarPaneles(); setCobrando(true); }}>Cobrar</button>}
          </div>
          {cobrando && (
            <CobrarDeuda clienteId={clienteId} usuarioActual={usuarioActual}
                         onCobrado={() => { setCobrando(false); cargar(); }}
                         onCancelar={() => setCobrando(false)} />
          )}
        </div>
      )}

      {/* El boton de vender va arriba, antes de la lista. Debajo quedaba enterrado
          bajo un historial que solo crece, y es la accion que mas se usa. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 30, gap: 12 }}>
        <h2 style={{ margin: 0 }}>Membresías</h2>
        {!mostrarVender && (
          <button onClick={() => { cerrarPaneles(); setMostrarVender(true); }}>+ Vender membresía</button>
        )}
      </div>

      {mostrarVender && (
        <VenderMembresiaForm clienteId={clienteId} usuarioActual={usuarioActual}
                             onVendido={despuesDeVender} onCancelar={() => setMostrarVender(false)} />
      )}

      <div style={{ marginTop: 12 }}>
        {membresias.length === 0 && <p>Este cliente no tiene ninguna membresía todavía.</p>}
        {arriba.map(tarjeta)}
      </div>

      {abajo.length > 0 && (
        <>
          <button
            onClick={() => setVerHistorial(v => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--acento-claro)', cursor: 'pointer', padding: '4px 0' }}
          >
            {verHistorial ? '▾ Ocultar historial' : `▸ Ver historial (${abajo.length})`}
          </button>
          {verHistorial && <div style={{ marginTop: 8 }}>{abajo.map(tarjeta)}</div>}
        </>
      )}
    </div>
  );
}
