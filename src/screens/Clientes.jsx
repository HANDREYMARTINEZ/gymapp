import { useState } from 'react';
import ClienteForm from './ClienteForm';

export default function Clientes() {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  const [modo, setModo] = useState('lista'); // 'lista' | 'nuevo' | 'editar'
  const [clienteEditando, setClienteEditando] = useState(null);

  async function buscar(texto) {
    setQuery(texto);
    if (texto.trim().length === 0) {
      setResultados([]);
      return;
    }
    const r = await window.api.clientes.buscar(texto);
    setResultados(r);
  }

  async function abrirEditar(id) {
    const cliente = await window.api.clientes.obtener(id);
    setClienteEditando(cliente);
    setModo('editar');
  }

  function volverALista() {
    setModo('lista');
    setClienteEditando(null);
    buscar(query); // refresca resultados por si algo cambió
  }

  return (
    <div>
      <h1>Clientes</h1>

      {modo === 'lista' && (
        <>
          <input
            placeholder="Buscar por nombre o documento..."
            value={query}
            onChange={e => buscar(e.target.value)}
            style={{ width: 300 }}
          />
          <button onClick={() => setModo('nuevo')} style={{ marginLeft: 8 }}>+ Nuevo cliente</button>

          <ul style={{ listStyle: 'none', padding: 0, marginTop: 20 }}>
            {resultados.map(c => (
              <li key={c.id} style={{ padding: 8, borderBottom: '1px solid #eee', cursor: 'pointer' }} onClick={() => abrirEditar(c.id)}>
                <b>{c.nombre}</b> — {c.documento || 'sin documento'} — {c.telefono || 'sin teléfono'}
              </li>
            ))}
          </ul>
          {query && resultados.length === 0 && <p>Sin resultados</p>}
        </>
      )}

      {modo === 'nuevo' && <ClienteForm onGuardado={volverALista} onCancelar={volverALista} />}
      {modo === 'editar' && <ClienteForm clienteExistente={clienteEditando} onGuardado={volverALista} onCancelar={volverALista} />}
    </div>
  );
}