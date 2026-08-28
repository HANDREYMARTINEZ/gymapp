import { useState, useEffect } from 'react';

const CAMPOS_GIMNASIO = [
  { clave: 'gym_nombre', etiqueta: 'Nombre' },
  { clave: 'gym_direccion', etiqueta: 'Dirección' },
  { clave: 'gym_telefono', etiqueta: 'Teléfono' },
  { clave: 'gym_nit', etiqueta: 'NIT' },
];

function formatearTamano(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatearFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function Configuracion() {
  const [datos, setDatos] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [avisoDatos, setAvisoDatos] = useState('');

  const [respaldos, setRespaldos] = useState([]);
  const [generando, setGenerando] = useState(false);
  const [avisoRespaldo, setAvisoRespaldo] = useState(null);
  // Confirmación en la propia pantalla: los diálogos nativos congelan la ventana.
  const [porRestaurar, setPorRestaurar] = useState(null);
  const [restaurando, setRestaurando] = useState(false);

  async function cargarDatos() {
    const leidos = {};
    for (const campo of CAMPOS_GIMNASIO) {
      leidos[campo.clave] = (await window.api.config.get(campo.clave)) || '';
    }
    setDatos(leidos);
  }

  async function cargarRespaldos() {
    setRespaldos(await window.api.backup.listar());
  }

  useEffect(() => { cargarDatos(); cargarRespaldos(); }, []);

  async function guardarDatos() {
    setGuardando(true);
    setAvisoDatos('');
    for (const campo of CAMPOS_GIMNASIO) {
      await window.api.config.set(campo.clave, datos[campo.clave] || '');
    }
    setGuardando(false);
    setAvisoDatos('Datos guardados.');
  }

  async function generarRespaldo() {
    setGenerando(true);
    setAvisoRespaldo(null);
    try {
      const r = await window.api.backup.generar();
      setAvisoRespaldo({ tipo: 'ok', texto: 'Respaldo generado: ' + r.ruta });
      await cargarRespaldos();
    } catch (e) {
      setAvisoRespaldo({ tipo: 'error', texto: 'No se pudo generar el respaldo: ' + e.message });
    }
    setGenerando(false);
  }

  async function confirmarRestauracion() {
    setRestaurando(true);
    setAvisoRespaldo(null);
    try {
      // Si sale bien la app se reinicia sola: esta línea no vuelve.
      await window.api.backup.restaurar(porRestaurar.ruta);
    } catch (e) {
      setRestaurando(false);
      setPorRestaurar(null);
      setAvisoRespaldo({ tipo: 'error', texto: 'No se pudo restaurar: ' + e.message });
    }
  }

  return (
    <div>
      <h1>Configuración</h1>

      <section style={{ marginBottom: 40 }}>
        <h2>Datos del gimnasio</h2>
        {CAMPOS_GIMNASIO.map(campo => (
          <div key={campo.clave} style={{ marginBottom: 8 }}>
            <label style={{ display: 'inline-block', width: 100 }}>{campo.etiqueta}</label>
            <input
              value={datos[campo.clave] || ''}
              onChange={e => { setDatos({ ...datos, [campo.clave]: e.target.value }); setAvisoDatos(''); }}
              style={{ width: 280 }}
            />
          </div>
        ))}
        <button onClick={guardarDatos} disabled={guardando} style={{ marginTop: 8 }}>
          {guardando ? 'Guardando...' : 'Guardar datos'}
        </button>
        {avisoDatos && <span style={{ marginLeft: 10, color: 'var(--exito)' }}>{avisoDatos}</span>}
      </section>

      <section>
        <h2>Respaldos</h2>
        <p style={{ maxWidth: 620, color: 'var(--texto-suave)' }}>
          Cada respaldo es una copia cifrada de toda la base, y solo se abre con la
          passphrase de esta instalación. Se genera uno automáticamente al cerrar la
          app y se conservan los 14 más recientes.
        </p>

        <button onClick={generarRespaldo} disabled={generando || restaurando}>
          {generando ? 'Generando...' : 'Generar respaldo ahora'}
        </button>

        {avisoRespaldo && (
          <p style={{ color: avisoRespaldo.tipo === 'ok' ? 'var(--exito)' : 'var(--error)', wordBreak: 'break-all' }}>
            {avisoRespaldo.texto}
          </p>
        )}

        {porRestaurar && (
          <div style={{ marginTop: 16, padding: 16, border: '2px solid var(--error)', maxWidth: 620 }}>
            <p style={{ marginTop: 0 }}>
              <b>Restaurar {porRestaurar.nombre}</b>
            </p>
            <p>
              Se reemplazará toda la base actual por la del {formatearFecha(porRestaurar.fecha)}.
              Todo lo registrado después de esa fecha dejará de estar disponible, y la app se
              reiniciará para aplicar el cambio. La base actual se guarda antes, por si hay que volver.
            </p>
            <button onClick={confirmarRestauracion} disabled={restaurando}>
              {restaurando ? 'Restaurando...' : 'Sí, restaurar y reiniciar'}
            </button>
            <button onClick={() => setPorRestaurar(null)} disabled={restaurando} style={{ marginLeft: 8 }}>
              Cancelar
            </button>
          </div>
        )}

        <table style={{ marginTop: 20, borderCollapse: 'collapse', width: '100%', maxWidth: 720 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--borde-fuerte)' }}>
              <th>Fecha</th><th>Tamaño</th><th></th>
            </tr>
          </thead>
          <tbody>
            {respaldos.map(r => (
              <tr key={r.ruta} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                <td>{formatearFecha(r.fecha)}</td>
                <td>{formatearTamano(r.tamanoBytes)}</td>
                <td>
                  <button onClick={() => { setPorRestaurar(r); setAvisoRespaldo(null); }} disabled={restaurando}>
                    Restaurar
                  </button>
                </td>
              </tr>
            ))}
            {respaldos.length === 0 && (
              <tr><td colSpan={3} style={{ paddingTop: 12, color: 'var(--texto-tenue)' }}>Todavía no hay respaldos.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
