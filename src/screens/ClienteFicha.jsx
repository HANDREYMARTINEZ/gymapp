import { useState, useEffect } from 'react';

const COLOR_ESTADO = {
  activa: '#2e7d32',
  por_vencer: '#f9a825',
  vencida: '#c62828',
  agotada: '#c62828',
  pausada: '#616161',
  saldo_pendiente: '#e65100',
  anulada: '#9e9e9e',
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

export default function ClienteFicha({ clienteId, onEditar, onVolver }) {
  const [cliente, setCliente] = useState(null);
  const [membresias, setMembresias] = useState([]);
  const [expandidaId, setExpandidaId] = useState(null);
  const [pagosPorMembresia, setPagosPorMembresia] = useState({});
  const [pausasPorMembresia, setPausasPorMembresia] = useState({});

  async function cargar() {
    const c = await window.api.clientes.obtener(clienteId);
    setCliente(c);
    const m = await window.api.membresias.listarPorCliente(clienteId);
    setMembresias(m);
  }

  useEffect(() => { cargar(); }, [clienteId]);

  async function expandir(membresiaId) {
    if (expandidaId === membresiaId) {
      setExpandidaId(null);
      return;
    }
    setExpandidaId(membresiaId);
    if (!pagosPorMembresia[membresiaId]) {
      const pagos = await window.api.membresias.listarPagos(membresiaId);
      setPagosPorMembresia(prev => ({ ...prev, [membresiaId]: pagos }));
    }
    if (!pausasPorMembresia[membresiaId]) {
      const pausas = await window.api.pausas.listarPorMembresia(membresiaId);
      setPausasPorMembresia(prev => ({ ...prev, [membresiaId]: pausas }));
    }
  }

  if (!cliente) return <p>Cargando...</p>;

  return (
    <div>
      <button onClick={onVolver}>← Volver a la lista</button>
      <h1 style={{ marginBottom: 4 }}>{cliente.nombre}</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        {cliente.documento || 'sin documento'} — {cliente.telefono || 'sin teléfono'} — {cliente.email || 'sin email'}
      </p>
      <button onClick={() => onEditar(cliente)}>Editar datos del cliente</button>

      <h2 style={{ marginTop: 30 }}>Membresías</h2>
      {membresias.length === 0 && <p>Este cliente no tiene ninguna membresía todavía.</p>}

      {membresias.map(m => (
        <div key={m.id} style={{ border: '1px solid #ddd', borderRadius: 4, marginBottom: 10, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => expandir(m.id)}>
            <div>
              <b>{m.plan_nombre}</b> ({m.plan_tipo === 'periodo' ? `${m.f_inicio} → ${m.f_fin}` : `${m.tickets_totales - m.tickets_usados} de ${m.tickets_totales} tickets`})
            </div>
            <span style={{ color: 'white', background: COLOR_ESTADO[m.estado] || '#999', padding: '2px 10px', borderRadius: 12, fontSize: 12 }}>
              {LABEL_ESTADO[m.estado] || m.estado}
            </span>
          </div>

          {m.saldoPendiente > 0 && (
            <p style={{ color: '#e65100', marginBottom: 0 }}>Saldo pendiente: ${m.saldoPendiente.toLocaleString('es-CO')}</p>
          )}

          {expandidaId === m.id && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
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
    </div>
  );
}
