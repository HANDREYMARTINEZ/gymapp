import { useState, useEffect } from 'react';
import VenderMembresiaForm from './VenderMembresiaForm';
import RegistrarPagoForm from './RegistrarPagoForm';

const COLOR_ESTADO = {
  activa: 'var(--exito-solido)',
  por_vencer: 'var(--aviso-solido)',
  vencida: 'var(--error-solido)',
  agotada: 'var(--error-solido)',
  pausada: 'var(--neutro-solido)',
  saldo_pendiente: 'var(--aviso-solido)',
  anulada: 'var(--neutro-solido)',
};

const LABEL_ESTADO = {
  activa: 'Activa',
  por_vencer: 'Por vencer',
  vencida: 'Vencida',
  agotada: 'Agotada',
  pausada: 'Pausada',
  saldo_pendiente: 'Saldo pendiente',
  anulada: 'Anulada',
};

export default function ClienteFicha({ clienteId, usuarioActual, onEditar, onVolver }) {
  const [cliente, setCliente] = useState(null);
  const [membresias, setMembresias] = useState([]);
  const [expandidaId, setExpandidaId] = useState(null);
  const [pagosPorMembresia, setPagosPorMembresia] = useState({});
  const [pausasPorMembresia, setPausasPorMembresia] = useState({});
  const [mostrarVender, setMostrarVender] = useState(false);
  const [mostrarPagoId, setMostrarPagoId] = useState(null);
  const [mostrarPausaId, setMostrarPausaId] = useState(null);
  const [motivoPausa, setMotivoPausa] = useState('');

  async function cargar() {
    const c = await window.api.clientes.obtener(clienteId);
    setCliente(c);
    const m = await window.api.membresias.listarPorCliente(clienteId);
    setMembresias(m);
    setPagosPorMembresia({});
    setPausasPorMembresia({});
  }

  useEffect(() => { cargar(); }, [clienteId]);

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
    setMostrarPausaId(null);
    setMotivoPausa('');
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

  function despuesDePago() {
    setMostrarPagoId(null);
    cargar();
  }

  if (!cliente) return <p>Cargando...</p>;

  return (
    <div>
      <button onClick={onVolver}>← Volver a la lista</button>
      <h1 style={{ marginBottom: 4 }}>{cliente.nombre}</h1>
      <p style={{ color: 'var(--texto-suave)', marginTop: 0 }}>
        {cliente.documento || 'sin documento'} — {cliente.telefono || 'sin teléfono'} — {cliente.email || 'sin email'}
      </p>
      <button onClick={() => onEditar(cliente)}>Editar datos del cliente</button>

      <h2 style={{ marginTop: 30 }}>Membresías</h2>
      {membresias.length === 0 && <p>Este cliente no tiene ninguna membresía todavía.</p>}

      {membresias.map(m => (
        <div key={m.id} style={{ border: '1px solid var(--borde-suave)', borderRadius: 4, marginBottom: 10, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => expandir(m.id)}>
            <div>
              <b>{m.plan_nombre}</b> ({m.plan_tipo === 'periodo' ? `${m.f_inicio} → ${m.f_fin}` : `${m.tickets_totales - m.tickets_usados} de ${m.tickets_totales} tickets`})
            </div>
            <span style={{ color: 'var(--texto)', background: COLOR_ESTADO[m.estado] || 'var(--neutro-solido)', padding: '2px 10px', borderRadius: 12, fontSize: 12 }}>
              {LABEL_ESTADO[m.estado] || m.estado}
            </span>
          </div>

          {m.saldoPendiente > 0 && (
            <p style={{ color: 'var(--aviso)', marginBottom: 0 }}>Saldo pendiente: ${m.saldoPendiente.toLocaleString('es-CO')}</p>
          )}

          {m.anulada === 0 && (
            <div style={{ marginTop: 8 }}>
              {m.saldoPendiente > 0 && (
                <button onClick={(e) => { e.stopPropagation(); setMostrarPagoId(mostrarPagoId === m.id ? null : m.id); }}>
                  Registrar pago
                </button>
              )}
              {m.estado === 'pausada'
                ? <button onClick={(e) => { e.stopPropagation(); reactivar(m.id); }} style={{ marginLeft: 8 }}>Reactivar</button>
                : <button onClick={(e) => { e.stopPropagation(); setMostrarPausaId(mostrarPausaId === m.id ? null : m.id); }} style={{ marginLeft: 8 }}>Pausar</button>
              }
            </div>
          )}

          {mostrarPausaId === m.id && (
            <div style={{ marginTop: 8, padding: 8, background: 'var(--superficie-alta)', borderRadius: 4 }} onClick={e => e.stopPropagation()}>
              <input placeholder="Motivo de la pausa (opcional)" value={motivoPausa} onChange={e => setMotivoPausa(e.target.value)} />
              <button onClick={() => confirmarPausa(m.id)} style={{ marginLeft: 8 }}>Confirmar pausa</button>
              <button onClick={() => { setMostrarPausaId(null); setMotivoPausa(''); }} style={{ marginLeft: 8 }}>Cancelar</button>
            </div>
          )}

          {mostrarPagoId === m.id && (
            <RegistrarPagoForm membresiaId={m.id} usuarioActual={usuarioActual} onGuardado={despuesDePago} onCancelar={() => setMostrarPagoId(null)} />
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
      ))}

      {mostrarVender
        ? <VenderMembresiaForm clienteId={clienteId} usuarioActual={usuarioActual} onVendido={despuesDeVender} onCancelar={() => setMostrarVender(false)} />
        : <button onClick={() => setMostrarVender(true)}>+ Vender membresía</button>
      }
    </div>
  );
}