import { useState, useEffect } from 'react';
import PlanForm from './PlanForm';

export default function Planes() {
  const [planes, setPlanes] = useState([]);
  const [modo, setModo] = useState('lista');
  const [planEditando, setPlanEditando] = useState(null);

  async function cargar() {
    const r = await window.api.planes.listarTodos();
    setPlanes(r);
  }

  useEffect(() => { cargar(); }, []);

  function volverALista() {
    setModo('lista');
    setPlanEditando(null);
    cargar();
  }

  async function toggleActivo(plan) {
    if (plan.activo) {
      if (!confirm('¿Desactivar este plan? Ya no aparecerá disponible para nuevas ventas.')) return;
      await window.api.planes.desactivar(plan.id);
    } else {
      await window.api.planes.activar(plan.id);
    }
    cargar();
  }

  return (
    <div>
      <h1>Planes</h1>

      {modo === 'lista' && (
        <>
          <button onClick={() => setModo('nuevo')}>+ Nuevo plan</button>
          <table style={{ marginTop: 20, borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
                <th>Nombre</th><th>Tipo</th><th>Precio</th><th>Detalle</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {planes.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee', opacity: p.activo ? 1 : 0.5 }}>
                  <td style={{ borderLeft: `4px solid ${p.color || '#ccc'}`, paddingLeft: 8 }}>{p.nombre}</td>
                  <td>{p.tipo}</td>
                  <td>${p.precio.toLocaleString('es-CO')}</td>
                  <td>{p.tipo === 'periodo' ? `${p.dias_duracion} días` : `${p.num_tickets} tickets${p.dias_vigencia ? ` / ${p.dias_vigencia} días` : ''}`}</td>
                  <td>{p.activo ? 'Activo' : 'Inactivo'}</td>
                  <td>
                    <button onClick={() => { setPlanEditando(p); setModo('editar'); }}>Editar</button>
                    <button onClick={() => toggleActivo(p)} style={{ marginLeft: 4 }}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {modo === 'nuevo' && <PlanForm onGuardado={volverALista} onCancelar={volverALista} />}
      {modo === 'editar' && <PlanForm planExistente={planEditando} onGuardado={volverALista} onCancelar={volverALista} />}
    </div>
  );
}