import { useState } from 'react';
import ClienteForm from './ClienteForm';
import ClienteFicha from './ClienteFicha';

export default function Clientes({ usuarioActual }) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  const [modo, setModo] = useState('lista'); // 'lista' | 'nuevo' | 'editar' | 'ficha'
  const [clienteEditando, setClienteEditando] = useState(null);
  const [clienteFichaId, setClienteFichaId] = useState(null);

  async function buscar(texto) {
    setQuery(texto);
    if (texto.trim().length === 0) {
      setResultados([]);
      return;
    }
    const r = await window.api.clientes.buscar(texto);
    setResultados(r);
  }

  function abrirFicha(id) {
    setClienteFichaId(id);
    setModo('ficha');
  }

  function volverALista() {
    setModo('lista');
    setClienteEditando(null);
    setClienteFichaId(null);
    buscar(query);
  }

  return (
    <div>
      {modo === 'lista' && (
        <>
          <h1>Clientes</h1>
          <input
            placeholder="Buscar por nombre o documento..."
            value={query}
            onChange={e => buscar(e.target.value)}
            style={{ width: 300 }}
          />
          <button onClick={() => setModo('nuevo')} style={{ marginLeft: 8 }}>+ Nuevo cliente</button>

          <ul style={{ listStyle: 'none', padding: 0, marginTop: 20 }}>
            {resultados.map(c => (
              <li key={c.id} style={{ padding: 8, borderBottom: '1px solid var(--borde-suave)', cursor: 'pointer' }} onClick={() => abrirFicha(c.id)}>
                <b>{c.nombre}</b> — {c.documento || 'sin documento'} — {c.telefono || 'sin teléfono'}
              </li>
            ))}
          </ul>
          {query && resultados.length === 0 && <p>Sin resultados</p>}
        </>
      )}

      {modo === 'nuevo' && <ClienteForm onGuardado={volverALista} onCancelar={volverALista} />}
      {modo === 'editar' && <ClienteForm clienteExistente={clienteEditando} onGuardado={volverALista} onCancelar={volverALista} />}
      {modo === 'ficha' && (
        <ClienteFicha
        clienteId={clienteFichaId}
        usuarioActual={usuarioActual}
        onVolver={volverALista}
        onEditar={(cliente) => { setClienteEditando(cliente); setModo('editar'); }}
        />
      )}
    </div>
  );
}