import { useState, useEffect, useCallback } from 'react';
import ClienteForm from './ClienteForm';
import ClienteFicha from './ClienteFicha';
import VenderMembresiaForm from './VenderMembresiaForm';
import RegistrarPagoForm from './RegistrarPagoForm';

// Estos colores son FONDO de etiqueta con letra clara encima, asi que todos
// tienen que ser tonos oscuros. "Programada" usa el oro apagado y no el
// amarillo de la marca justo por eso: el amarillo vivo se come la letra.
const COLOR_ESTADO = {
  activa: 'var(--exito-solido)',
  por_vencer: 'var(--aviso-solido)',
  programada: 'var(--acento-profundo)',
  vencida: 'var(--error-solido)',
  agotada: 'var(--error-solido)',
  pausada: 'var(--neutro-solido)',
  saldo_pendiente: 'var(--aviso-solido)',
  anulada: 'var(--neutro-solido)',
  sin_membresia: 'var(--neutro-solido)',
};

const LABEL_ESTADO = {
  activa: 'Activa',
  por_vencer: 'Por vencer',
  programada: 'Programada',
  vencida: 'Vencida',
  agotada: 'Sin tickets',
  pausada: 'Pausada',
  saldo_pendiente: 'Saldo pendiente',
  anulada: 'Anulada',
  sin_membresia: 'Sin membresía',
};

const pesos = (n) => '$' + n.toLocaleString('es-CO');

function Etiqueta({ estado }) {
  return (
    <span style={{
      background: COLOR_ESTADO[estado] || 'var(--neutro-solido)',
      color: 'var(--texto)', padding: '2px 9px', borderRadius: 12,
      fontSize: 11, whiteSpace: 'nowrap',
    }}>
      {LABEL_ESTADO[estado] || estado}
    </span>
  );
}

function Tarjeta({ titulo, vacio, children }) {
  return (
    <div style={{
      background: 'var(--superficie)', border: '1px solid var(--borde-suave)',
      borderRadius: 'var(--radio)', padding: 14, marginBottom: 16,
    }}>
      <h3 style={{ marginTop: 0 }}>{titulo}</h3>
      {vacio ? <p style={{ color: 'var(--texto-tenue)', margin: 0 }}>{vacio}</p> : children}
    </div>
  );
}

export default function Clientes({ usuarioActual }) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  const [lateral, setLateral] = useState({ conSaldo: [], noPuedenEntrenar: [] });
  const [modo, setModo] = useState('lista'); // 'lista' | 'nuevo' | 'editar' | 'ficha'
  const [clienteEditando, setClienteEditando] = useState(null);
  const [clienteFichaId, setClienteFichaId] = useState(null);
  const [pausandoId, setPausandoId] = useState(null);
  const [motivoPausa, setMotivoPausa] = useState('');
  const [vendiendoA, setVendiendoA] = useState(null);
  const [pagandoMembresia, setPagandoMembresia] = useState(null);

  const buscar = useCallback(async (texto) => {
    setResultados(await window.api.clientes.buscarConEstado(texto));
  }, []);

  const recargarLateral = useCallback(async () => {
    setLateral(await window.api.clientes.panelLateral());
  }, []);

  useEffect(() => {
    if (modo === 'lista') { buscar(query); recargarLateral(); }
  }, [modo]);

  async function alEscribir(texto) {
    setQuery(texto);
    buscar(texto);
  }

  // Todo lo que mueve dinero o estado repinta las dos columnas, pero solo ellas:
  // la pantalla no se desmonta, asi que no se pierde lo escrito en el buscador.
  async function refrescar() {
    await Promise.all([buscar(query), recargarLateral()]);
  }

  function abrirFicha(id) {
    setClienteFichaId(id);
    setModo('ficha');
  }

  function volverALista() {
    setModo('lista');
    setClienteEditando(null);
    setClienteFichaId(null);
  }

  function cerrarPaneles() {
    setPausandoId(null);
    setMotivoPausa('');
    setVendiendoA(null);
    setPagandoMembresia(null);
  }

  async function confirmarPausa(membresiaId) {
    await window.api.pausas.pausar({ membresiaId, motivo: motivoPausa, usuarioId: usuarioActual.id });
    cerrarPaneles();
    refrescar();
  }

  // El formulario de venta se abre dentro de la tarjeta de la izquierda, asi que
  // primero hay que asegurarse de que ese cliente esta en la lista: se busca por
  // su nombre en vez de dar por hecho que ya se ve.
  function venderDesdeElPanel(c) {
    cerrarPaneles();
    setQuery(c.nombre);
    buscar(c.nombre);
    setVendiendoA(c.id);
  }

  async function editarCliente(id) {
    const completo = await window.api.clientes.obtener(id);
    setClienteEditando(completo);
    setModo('editar');
  }

  async function reactivar(membresiaId) {
    await window.api.pausas.reactivar(membresiaId);
    refrescar();
  }

  if (modo === 'nuevo') {
    return <ClienteForm onGuardado={volverALista} onCancelar={volverALista} />;
  }
  if (modo === 'editar') {
    return <ClienteForm clienteExistente={clienteEditando} onGuardado={volverALista} onCancelar={volverALista} />;
  }
  if (modo === 'ficha') {
    return (
      <ClienteFicha
        clienteId={clienteFichaId}
        usuarioActual={usuarioActual}
        onEditar={(c) => { setClienteEditando(c); setModo('editar'); }}
        onVolver={volverALista}
      />
    );
  }

  return (
    <div>
      <h1>Clientes</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1.4fr) minmax(300px, 1fr)', gap: 20, alignItems: 'start' }}>

        {/* ---------------- Izquierda: la lista buscable ---------------- */}
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              placeholder="Buscar por nombre o documento..."
              value={query}
              onChange={e => alEscribir(e.target.value)}
              style={{ flex: 1 }}
            />
            <button onClick={() => setModo('nuevo')}>+ Nuevo cliente</button>
          </div>

          {resultados.length === 0 && (
            <p style={{ color: 'var(--texto-tenue)' }}>
              {query ? 'Ningún cliente coincide con esa búsqueda.' : 'Todavía no hay clientes registrados.'}
            </p>
          )}

          {resultados.map(c => (
            <div key={c.id} style={{
              border: '1px solid var(--borde-suave)', borderRadius: 'var(--radio)',
              padding: 10, marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ cursor: 'pointer', minWidth: 0 }} onClick={() => abrirFicha(c.id)}>
                  <b>{c.nombre}</b>
                  <div style={{ fontSize: 12, color: 'var(--texto-tenue)' }}>
                    {c.documento || 'sin documento'}{c.documentoProvisional && (
                      <span title="Cédula provisional: a este cliente le falta el documento"
                            style={{ marginLeft: 6, color: 'var(--aviso)' }}>{'\u26A0'}</span>
                    )} · {c.telefono || 'sin teléfono'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <Etiqueta estado={c.estado} />
                  <button title="Editar" onClick={() => editarCliente(c.id)}>✎</button>
                  {c.membresiaId && (
                    c.estado === 'pausada'
                      ? <button title="Reactivar" onClick={() => reactivar(c.membresiaId)}>▶</button>
                      : <button title="Pausar" onClick={() => { cerrarPaneles(); setPausandoId(c.membresiaId); }}>⏸</button>
                  )}
                  <button title="Vender membresía" onClick={() => { cerrarPaneles(); setVendiendoA(c.id); }}>+</button>
                </div>
              </div>

              {pausandoId === c.membresiaId && c.membresiaId && (
                <div style={{ marginTop: 8, padding: 8, background: 'var(--superficie-alta)', borderRadius: 'var(--radio)' }}>
                  <input placeholder="Motivo de la pausa (opcional)" value={motivoPausa}
                         onChange={e => setMotivoPausa(e.target.value)} />
                  <button onClick={() => confirmarPausa(c.membresiaId)} style={{ marginLeft: 8 }}>Confirmar pausa</button>
                  <button onClick={cerrarPaneles} style={{ marginLeft: 8 }}>Cancelar</button>
                </div>
              )}

              {vendiendoA === c.id && (
                <VenderMembresiaForm
                  clienteId={c.id}
                  usuarioActual={usuarioActual}
                  onVendido={() => { cerrarPaneles(); refrescar(); }}
                  onCancelar={cerrarPaneles}
                />
              )}
            </div>
          ))}
        </div>

        {/* ---------------- Derecha: los dos bloques de aviso ---------------- */}
        <div>
          <Tarjeta
            titulo={`Con saldo pendiente (${lateral.conSaldo.length})`}
            vacio={lateral.conSaldo.length === 0 ? 'Nadie debe dinero.' : null}
          >
            {lateral.conSaldo.map(c => (
              <div key={c.id} style={{ borderTop: '1px solid var(--borde-suave)', paddingTop: 8, marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ cursor: 'pointer' }} onClick={() => abrirFicha(c.id)}>{c.nombre}</span>
                  <b style={{ color: 'var(--aviso)', whiteSpace: 'nowrap' }}>{pesos(c.saldoPendiente)}</b>
                </div>
                {c.membresiasConSaldo.map(m => (
                  <div key={m.id} style={{ marginTop: 4 }}>
                    <button onClick={() => { cerrarPaneles(); setPagandoMembresia(m.id); }}
                            style={{ fontSize: 12, padding: '3px 8px' }}>
                      Pagar {m.planNombre} ({pesos(m.saldo)})
                    </button>
                    {pagandoMembresia === m.id && (
                      <RegistrarPagoForm
                        membresiaId={m.id}
                        fInicioActual={m.fInicio}
                        usuarioActual={usuarioActual}
                        onGuardado={() => { cerrarPaneles(); refrescar(); }}
                        onCancelar={cerrarPaneles}
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </Tarjeta>

          <Tarjeta
            titulo={`No pueden entrenar (${lateral.noPuedenEntrenar.length})`}
            vacio={lateral.noPuedenEntrenar.length === 0 ? 'Nadie con la membresía vencida o sin tickets.' : null}
          >
            {lateral.noPuedenEntrenar.map(c => (
              <div key={c.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                borderTop: '1px solid var(--borde-suave)', paddingTop: 8, marginTop: 8,
              }}>
                <span style={{ cursor: 'pointer' }} onClick={() => abrirFicha(c.id)}>{c.nombre}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <Etiqueta estado={c.estado} />
                  <button onClick={() => venderDesdeElPanel(c)}
                          style={{ fontSize: 12, padding: '3px 8px' }}>
                    Vender
                  </button>
                </div>
              </div>
            ))}
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}
