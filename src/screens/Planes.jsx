import { useState, useEffect } from 'react';
import PlanForm from './PlanForm';

// Los planes que son el mismo escrito de otra forma. El backend ya marca los
// gemelos de cada uno; aquí solo se juntan para poder decirlo de una vez arriba
// en vez de repetir el aviso en cada fila.
function gruposRepetidos(planes) {
  const vistos = new Set();
  const grupos = [];
  for (const p of planes) {
    if (p.gemelos.length === 0 || vistos.has(p.id)) continue;
    const grupo = [p, ...p.gemelos.map(id => planes.find(q => q.id === id)).filter(Boolean)];
    for (const q of grupo) vistos.add(q.id);
    grupos.push(grupo);
  }
  return grupos;
}

export default function Planes() {
  const [planes, setPlanes] = useState([]);
  const [modo, setModo] = useState('lista');
  const [planEditando, setPlanEditando] = useState(null);
  const [porDesactivar, setPorDesactivar] = useState(null);

  async function cargar() {
    const r = await window.api.planes.listarTodos();
    setPlanes(r);
  }

  useEffect(() => { cargar(); }, []);

  const repetidos = gruposRepetidos(planes);
  const conEspacios = planes.filter(p => p.nombreConEspacios);

  function volverALista() {
    setModo('lista');
    setPlanEditando(null);
    cargar();
  }

  // La confirmacion va en la pantalla, no en un confirm() nativo: esos bloquean
  // el hilo del renderer y congelan la ventana, que es lo que se saco del Kiosco
  // en la sub-etapa 2.4.
  async function toggleActivo(plan) {
    if (plan.activo) {
      setPorDesactivar(plan);
      return;
    }
    await window.api.planes.activar(plan.id);
    cargar();
  }

  async function confirmarDesactivar() {
    await window.api.planes.desactivar(porDesactivar.id);
    setPorDesactivar(null);
    cargar();
  }

  return (
    <div>
      <h1>Planes</h1>

      {modo === 'lista' && (
        <>
          <button onClick={() => setModo('nuevo')}>+ Nuevo plan</button>

          {/* Lo que hay que ver ANTES de tocar nada. La importación del Excel
              dejó nombres con espacio al final y varias formas de escribir el
              mismo plan; eso no se ve mirando la lista, porque un espacio final
              es invisible. Cuál sobrevive lo decides tú: aquí solo se señala. */}
          {(repetidos.length > 0 || conEspacios.length > 0) && (
            <div style={{ marginTop: 16, padding: 14, maxWidth: 720,
                          border: '1px solid var(--aviso)', background: 'var(--aviso-fondo)',
                          borderRadius: 'var(--radio)' }}>
              <b>El catálogo tiene nombres que conviene arreglar.</b>

              {repetidos.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {repetidos.length === 1 ? 'Hay un plan escrito' : 'Hay ' + repetidos.length + ' planes escritos'}
                  {' '}de varias formas. Para la app son planes distintos, y en la pantalla
                  de Vender salen todos:
                  <ul style={{ margin: '6px 0 0' }}>
                    {repetidos.map((grupo, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {grupo.map(p => (
                          <code key={p.id} style={{ marginRight: 8 }}>
                            "{p.nombre}" (${p.precio.toLocaleString('es-CO')},{' '}
                            {p.membresiasEnUso} en uso / {p.membresiasHistorico} en total)
                          </code>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {conEspacios.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {conEspacios.length} con espacios sueltos al principio o al final
                  ({conEspacios.map(p => '"' + p.nombre + '"').join(', ')}). Se arreglan
                  entrando en <b>Editar</b> y guardando: el nombre se recorta solo al guardar.
                </div>
              )}

              <div style={{ marginTop: 8, color: 'var(--texto-suave)' }}>
                Desactivar un plan <b>no</b> rompe nada de lo ya vendido: cada membresía
                guarda copiado el nombre, el tipo y el precio del día en que se vendió.
                Mira la columna <b>En uso</b> antes de decidir.
              </div>
            </div>
          )}

          {porDesactivar && (
            <div style={{ border: '2px solid var(--error)', padding: 16, marginTop: 16, maxWidth: 480 }}>
              <p style={{ marginTop: 0 }}>
                ¿Desactivar <b>{porDesactivar.nombre}</b>? Dejará de aparecer al vender una
                membresía nueva. Las membresías ya vendidas con este plan siguen igual, y
                puedes reactivarlo cuando quieras.
              </p>
              {/* El dato que decide. Desactivar un plan que 20 personas están
                  usando no rompe sus membresías, pero sí impide renovárselas
                  con el mismo plan, y eso conviene saberlo antes y no después. */}
              {porDesactivar.membresiasEnUso > 0 && (
                <p style={{ color: 'var(--aviso)' }}>
                  {'⚠'} <b>{porDesactivar.membresiasEnUso}</b>{' '}
                  {porDesactivar.membresiasEnUso === 1
                    ? 'persona lo está usando ahora mismo'
                    : 'personas lo están usando ahora mismo'}. Sus membresías no se
                  tocan, pero no vas a poder renovárselas con este plan hasta que lo
                  reactives.
                </p>
              )}
              <button onClick={confirmarDesactivar}>Sí, desactivar</button>
              <button onClick={() => setPorDesactivar(null)} style={{ marginLeft: 8 }}>Cancelar</button>
            </div>
          )}
          <table style={{ marginTop: 20, borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--borde-fuerte)' }}>
                <th>Nombre</th><th>Tipo</th><th>Precio</th><th>Detalle</th>
                <th title="Membresías que hoy siguen dando acceso">En uso</th>
                <th title="Todas las membresías vendidas con este plan">Vendidas</th>
                <th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {planes.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--borde-suave)', opacity: p.activo ? 1 : 0.5 }}>
                  <td style={{ borderLeft: `4px solid ${p.color || 'var(--borde)'}`, paddingLeft: 8 }}>
                    {p.nombre}
                    {/* Un espacio al final es invisible: hay que decirlo. */}
                    {p.nombreConEspacios && (
                      <span title="Tiene espacios sueltos al principio o al final"
                            style={{ color: 'var(--aviso)', marginLeft: 6 }}>␣</span>
                    )}
                    {p.gemelos.length > 0 && (
                      <span title="Hay otro plan que se llama casi igual"
                            style={{ color: 'var(--aviso)', marginLeft: 6 }}>⧉</span>
                    )}
                  </td>
                  <td>{p.tipo}</td>
                  <td>${p.precio.toLocaleString('es-CO')}</td>
                  <td>{p.tipo === 'periodo' ? `${p.dias_duracion} días` : `${p.num_tickets} tickets${p.dias_vigencia ? ` / ${p.dias_vigencia} días` : ''}`}</td>
                  <td style={{ fontWeight: p.membresiasEnUso > 0 ? 'bold' : 'normal',
                               color: p.membresiasEnUso > 0 ? 'var(--texto)' : 'var(--texto-tenue)' }}>
                    {p.membresiasEnUso}
                  </td>
                  <td style={{ color: 'var(--texto-suave)' }}>
                    {p.membresiasHistorico}
                    {p.ultimaVenta && (
                      <span style={{ color: 'var(--texto-tenue)', marginLeft: 6, fontSize: 12 }}>
                        última {p.ultimaVenta}
                      </span>
                    )}
                  </td>
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