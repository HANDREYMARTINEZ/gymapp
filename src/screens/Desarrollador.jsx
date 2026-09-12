import { useState, useEffect } from 'react';

// Panel de desarrollador. Solo se llega aqui entrando con Ctrl+Alt+D y la
// passphrase, y el proceso principal vuelve a comprobarlo en cada llamada.
//
// Casi todo lo de esta pantalla es irreversible, asi que hay tres reglas que se
// repiten en cada bloque y valen mas que el diseno:
//
//   1. Se dice cuanto se va a borrar ANTES de borrarlo, con el numero delante.
//   2. Lo grave se confirma escribiendo una palabra, no con un boton mas.
//   3. Antes de cada borrado se genera un respaldo, y se dice si no se pudo.

const PALABRA_VACIAR = 'BORRAR';
const PALABRA_RESET = 'RESET';

function formatearTamano(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatearFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const caja = (color) => ({
  padding: 16,
  border: '1px solid ' + (color || 'var(--borde)'),
  borderRadius: 'var(--radio)',
  background: 'var(--superficie)',
  maxWidth: 760,
});

function Dato({ etiqueta, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '3px 0' }}>
      <span style={{ minWidth: 150, color: 'var(--texto-suave)', flexShrink: 0 }}>{etiqueta}</span>
      <span style={{ wordBreak: 'break-all' }}>{children}</span>
    </div>
  );
}

export default function Desarrollador() {
  const [diag, setDiag] = useState(null);
  const [zonas, setZonas] = useState([]);
  const [respaldos, setRespaldos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [aviso, setAviso] = useState(null);

  // Vaciado por zonas
  const [marcadas, setMarcadas] = useState([]);
  const [confirmaVaciar, setConfirmaVaciar] = useState('');
  const [vaciando, setVaciando] = useState(false);
  const [resultadoVaciar, setResultadoVaciar] = useState(null);

  // Reset de fabrica
  const [confirmaReset, setConfirmaReset] = useState('');
  const [reseteando, setReseteando] = useState(false);

  // Contrasenas
  const [usuarioId, setUsuarioId] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [cambiando, setCambiando] = useState(false);

  const [porBorrar, setPorBorrar] = useState(null);

  // Auditoria
  const [auditoria, setAuditoria] = useState([]);
  const [acciones, setAcciones] = useState([]);
  const [filtroAccion, setFiltroAccion] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [limite, setLimite] = useState(100);

  // Datos de demo
  const [sembrando, setSembrando] = useState(false);
  const [confirmaDemo, setConfirmaDemo] = useState(false);

  async function cargar() {
    const [d, z, r, u] = await Promise.all([
      window.api.desarrollador.diagnostico(),
      window.api.desarrollador.zonas(),
      window.api.backup.listar(),
      window.api.desarrollador.usuarios(),
    ]);
    if (d.ok) setDiag(d.datos);
    if (z.ok) setZonas(z.zonas);
    setRespaldos(r);
    if (u.ok) setUsuarios(u.usuarios);
    await cargarAuditoria();
  }

  async function cargarAuditoria() {
    const r = await window.api.desarrollador.auditoria({
      limite, accion: filtroAccion || undefined, texto: filtroTexto || undefined,
    });
    if (r.ok) { setAuditoria(r.filas); setAcciones(r.acciones); }
  }

  useEffect(() => { cargar(); }, []);

  // El desplegable y el tope releen solos. El campo de texto no: relee al pulsar
  // Enter o el boton, porque consultar en cada tecla sobre 500 filas parpadea.
  useEffect(() => { cargarAuditoria(); }, [filtroAccion, limite]);

  function alternarZona(id) {
    setMarcadas(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id]));
    setResultadoVaciar(null);
    setConfirmaVaciar('');
  }

  async function vaciar() {
    setVaciando(true);
    setResultadoVaciar(null);
    // Sin este try, cualquier excepcion del proceso principal dejaba el boton
    // en "Borrando..." para siempre y sin decir nada: la pantalla se quedaba
    // esperando una promesa que ya se habia rechazado.
    let r;
    try {
      r = await window.api.desarrollador.vaciar(marcadas);
    } catch (e) {
      r = { ok: false, motivo: 'error_inesperado', detalle: String(e && e.message ? e.message : e) };
    }
    setVaciando(false);
    setResultadoVaciar(r);
    setConfirmaVaciar('');
    if (r.ok) { setMarcadas([]); await cargar(); }
  }

  async function resetFabrica() {
    setReseteando(true);
    // Si sale bien la app se reinicia sola y esta linea no vuelve.
    const r = await window.api.desarrollador.resetFabrica();
    setReseteando(false);
    setAviso({ tipo: 'error', texto: 'No se pudo resetear: ' + (r.motivo || 'desconocido') });
  }

  async function eliminarRespaldo() {
    const r = await window.api.desarrollador.eliminarRespaldo(porBorrar.ruta);
    setPorBorrar(null);
    setAviso(r.ok
      ? { tipo: 'ok', texto: 'Respaldo eliminado: ' + r.nombre }
      : { tipo: 'error', texto: 'No se pudo eliminar: ' + r.motivo });
    await cargar();
  }

  async function borrarCopias() {
    const r = await window.api.desarrollador.borrarCopiasAntiguas();
    setAviso({ tipo: 'ok', texto: r.borradas + ' copias borradas (' + formatearTamano(r.bytes) + ' liberados).' });
    await cargar();
  }

  async function resetearPassword() {
    setCambiando(true);
    const r = await window.api.desarrollador.resetearPassword({
      usuarioId: Number(usuarioId), password: passNueva,
    });
    setCambiando(false);
    if (r.ok) {
      setPassNueva('');
      setAviso({ tipo: 'ok', texto: 'Contraseña cambiada. Ya puede entrar con ella y la base se le abre.' });
    } else {
      setAviso({ tipo: 'error', texto: r.motivo === 'password_muy_corta'
        ? 'La contraseña debe tener al menos 4 caracteres.'
        : 'No se pudo cambiar: ' + r.motivo });
    }
  }

  async function sembrarDemo() {
    setSembrando(true);
    const r = await window.api.desarrollador.sembrarDemo();
    setSembrando(false);
    setConfirmaDemo(false);
    if (r.ok) {
      const c = r.creado;
      setAviso({ tipo: 'ok', texto: 'Sembrado: ' + c.clientes + ' clientes, ' + c.planes +
        ' planes, ' + c.productos + ' productos, ' + c.membresias + ' membresias, ' +
        c.ventas + ' ventas y ' + c.asistencias + ' asistencias.' +
        (c.cajaAbierta ? ' Se abrio una caja con base de $50.000.' : ' La caja ya estaba abierta, se dejo como estaba.') });
      await cargar();
    } else {
      setAviso({ tipo: 'error', texto: 'No se pudo sembrar: ' + r.motivo });
    }
  }

  async function copiarDiagnostico() {
    await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
    setAviso({ tipo: 'ok', texto: 'Diagnóstico copiado al portapapeles.' });
  }

  const filasAVaciar = zonas.filter(z => marcadas.includes(z.id)).reduce((s, z) => s + z.filas, 0);
  const clientesAhora = diag ? (diag.conteos.find(c => c.tabla === 'clientes') || {}).filas || 0 : 0;

  return (
    <div>
      <h1>🔧 Desarrollador</h1>
      <p style={{ maxWidth: 760, color: 'var(--texto-suave)', marginTop: 0 }}>
        Esta pantalla no la ve nadie del gimnasio: aparece solo al entrar con
        Ctrl+Alt+D y la passphrase. Lo que hay aquí <b>borra datos de verdad</b>.
      </p>

      {aviso && (
        <p style={{ color: aviso.tipo === 'ok' ? 'var(--exito)' : 'var(--error)', wordBreak: 'break-all' }}>
          {aviso.texto}
        </p>
      )}

      {/* --- Diagnostico ------------------------------------------------- */}
      <section style={{ marginBottom: 36 }}>
        <h2>Diagnóstico de la instalación</h2>
        <p style={{ maxWidth: 760, color: 'var(--texto-suave)', marginTop: 0 }}>
          Lo primero que hay que mirar cuando llamen diciendo que no funciona.
        </p>

        {!diag ? <p>Leyendo...</p> : (
          <div style={caja()}>
            <Dato etiqueta="Base de datos">{diag.rutas.db}</Dato>
            <Dato etiqueta="Tamaño">
              {formatearTamano(diag.tamanos.db)}
              {diag.tamanos.wal > 0 && <> {'+ '}{formatearTamano(diag.tamanos.wal)} sin consolidar (WAL)</>}
            </Dato>
            <Dato etiqueta="Integridad">
              <span style={{ color: diag.integridad === 'ok' ? 'var(--exito)' : 'var(--error)' }}>
                {diag.integridad}
              </span>
            </Dato>
            <Dato etiqueta="Cifrado">
              {diag.cifradoAbierto
                ? <span style={{ color: 'var(--exito)' }}>abierto en esta sesión</span>
                : <span style={{ color: 'var(--error)' }}>cerrado: no se leen fotos ni huellas ni se puede respaldar</span>}
            </Dato>
            <Dato etiqueta="Respaldos">
              {diag.respaldos.cuantos} ({formatearTamano(diag.tamanos.respaldos)}), último {formatearFecha(diag.respaldos.ultimo)}
            </Dato>
            <Dato etiqueta="Lector de huella">
              {diag.sidecar.instalado
                ? (diag.sidecar.vivo ? 'sidecar encendido' : 'instalado, pero apagado ahora mismo')
                : <span style={{ color: 'var(--aviso)' }}>sidecar no instalado en esta máquina</span>}
            </Dato>
            <Dato etiqueta="Versiones">
              GymApp {diag.versiones.app} · Electron {diag.versiones.electron} · Node {diag.versiones.node} · SQLite {diag.versiones.sqlite}
            </Dato>
            <Dato etiqueta="Migraciones">{diag.migraciones.length} aplicadas · última {diag.migraciones.length ? diag.migraciones[diag.migraciones.length - 1].nombre : '—'}</Dato>
            <Dato etiqueta="Carpeta de datos">{diag.rutas.userData}</Dato>

            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={cargar}>Actualizar</button>
              <button onClick={copiarDiagnostico}>Copiar todo al portapapeles</button>
              <button onClick={() => window.api.intercambio.mostrarEnCarpeta(diag.rutas.db)}>
                Abrir la carpeta de datos
              </button>
            </div>

            <table style={{ marginTop: 18, borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--borde)' }}>
                  <th>Tabla</th><th>Filas</th>
                </tr>
              </thead>
              <tbody>
                {diag.conteos.map(c => (
                  <tr key={c.tabla}>
                    <td style={{ color: 'var(--texto-suave)' }}>{c.tabla}</td>
                    <td>{c.filas}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Las copias que dejan atras un restaurar o un reset. Se listan
                porque si no, nadie sabe que estan ahi ocupando disco. */}
            {diag.copiasAntiguas.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--borde-suave)' }}>
                <p style={{ marginTop: 0 }}>
                  <b>{diag.copiasAntiguas.length} copias antiguas de la base</b>{' '}
                  ({formatearTamano(diag.tamanos.copiasAntiguas)}), de restauraciones y resets
                  anteriores. Son bases completas: mientras estén aquí, se puede volver a ellas.
                </p>
                <ul style={{ color: 'var(--texto-suave)', marginTop: 0 }}>
                  {diag.copiasAntiguas.map(c => (
                    <li key={c.nombre}>{c.nombre} — {formatearTamano(c.bytes)}</li>
                  ))}
                </ul>
                <button onClick={borrarCopias}>Borrar las copias antiguas</button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* --- Vaciado por zonas ------------------------------------------- */}
      <section style={{ marginBottom: 36 }}>
        <h2>Vaciar datos</h2>
        <p style={{ maxWidth: 760, color: 'var(--texto-suave)', marginTop: 0 }}>
          Borra los datos que elijas y <b>conserva la instalación</b>: usuarios,
          contraseñas, planes, configuración y el cifrado siguen como están. Es lo
          que se usa para entregarle la app limpia al gimnasio después de probarla.
        </p>

        <div style={caja()}>
          {zonas.map(z => (
            <label key={z.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={marcadas.includes(z.id)} onChange={() => alternarZona(z.id)}
                     style={{ marginTop: 3 }} />
              <span>
                <b style={{ color: 'var(--texto)' }}>{z.etiqueta}</b>{' '}
                <span style={{ color: 'var(--texto-tenue)' }}>({z.filas} {z.filas === 1 ? 'registro' : 'registros'})</span>
                <br />
                <small style={{ color: 'var(--texto-suave)' }}>Se lleva {z.detalle}.</small>
              </span>
            </label>
          ))}

          {marcadas.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--borde-suave)' }}>
              <p style={{ marginTop: 0 }}>
                Se van a borrar <b>{filasAVaciar}</b> registros principales y todo lo que cuelga de ellos.
                Antes se genera un respaldo automático.
              </p>
              <p style={{ marginBottom: 6, color: 'var(--texto-suave)' }}>
                Escribe <b>{PALABRA_VACIAR}</b> para confirmar:
              </p>
              <input value={confirmaVaciar} onChange={e => setConfirmaVaciar(e.target.value)}
                     placeholder={PALABRA_VACIAR} style={{ width: 160 }} />
              <button onClick={vaciar}
                      disabled={vaciando || confirmaVaciar !== PALABRA_VACIAR}
                      style={{ marginLeft: 8 }}>
                {vaciando ? 'Borrando...' : 'Vaciar lo marcado'}
              </button>
            </div>
          )}

          {resultadoVaciar && !resultadoVaciar.ok && (
            <p style={{ color: 'var(--error)' }}>
              {resultadoVaciar.motivo === 'inventario_con_ventas'
                ? 'El inventario no se puede vaciar solo: hay ' + resultadoVaciar.lineasDeVenta +
                  ' líneas de venta que apuntan a esos productos. Marca también "Ventas y caja", o deja el inventario como está.'
                : resultadoVaciar.motivo === 'error_inesperado'
                  ? 'No se pudo vaciar: ' + (resultadoVaciar.detalle || 'error inesperado')
                  : 'No se pudo vaciar: ' + resultadoVaciar.motivo}
            </p>
          )}

          {resultadoVaciar && resultadoVaciar.ok && (
            <div style={{ marginTop: 12, color: 'var(--exito)' }}>
              <p style={{ marginBottom: 4 }}>Listo. Filas borradas:</p>
              <ul style={{ marginTop: 0, color: 'var(--texto-suave)' }}>
                {Object.entries(resultadoVaciar.borrados).map(([tabla, n]) => (
                  <li key={tabla}>{tabla}: {n}</li>
                ))}
              </ul>
              <p style={{ color: resultadoVaciar.respaldo.hecho ? 'var(--texto-suave)' : 'var(--aviso)', wordBreak: 'break-all' }}>
                {resultadoVaciar.respaldo.hecho
                  ? 'Respaldo previo: ' + resultadoVaciar.respaldo.ruta
                  : 'No se pudo generar el respaldo previo: ' + resultadoVaciar.respaldo.motivo}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* --- Respaldos ---------------------------------------------------- */}
      <section style={{ marginBottom: 36 }}>
        <h2>Respaldos</h2>
        <p style={{ maxWidth: 760, color: 'var(--texto-suave)', marginTop: 0 }}>
          Los mismos que salen en Configuración, pero aquí se pueden borrar. Un
          respaldo borrado no se recupera, y se descifra solo con la passphrase de
          esta instalación.
        </p>

        {porBorrar && (
          <div style={{ ...caja('var(--error)'), marginBottom: 12 }}>
            <p style={{ marginTop: 0 }}>
              Borrar <b>{porBorrar.nombre}</b> ({formatearTamano(porBorrar.tamanoBytes)},
              del {formatearFecha(porBorrar.fecha)}). No hay vuelta atrás.
            </p>
            <button onClick={eliminarRespaldo}>Sí, borrarlo</button>
            <button onClick={() => setPorBorrar(null)} style={{ marginLeft: 8 }}>Cancelar</button>
          </div>
        )}

        <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 760 }}>
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
                <td><button onClick={() => { setPorBorrar(r); setAviso(null); }}>Borrar</button></td>
              </tr>
            ))}
            {respaldos.length === 0 && (
              <tr><td colSpan={3} style={{ paddingTop: 12, color: 'var(--texto-tenue)' }}>No hay respaldos.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* --- Contrasenas --------------------------------------------------- */}
      <section style={{ marginBottom: 36 }}>
        <h2>Resetear la contraseña de un usuario</h2>
        <p style={{ maxWidth: 760, color: 'var(--texto-suave)', marginTop: 0 }}>
          Sin necesitar la anterior. Es la salida cuando el administrador del
          gimnasio olvida su clave: antes de esto había que restaurar un respaldo
          entero. La llave de cifrado del usuario se rehace con la contraseña
          nueva, así que entra y se le abre la base como siempre.
        </p>

        <div style={caja()}>
          <select value={usuarioId} onChange={e => setUsuarioId(e.target.value)} style={{ minWidth: 240 }}>
            <option value="">Elegir usuario...</option>
            {usuarios.map(u => (
              <option key={u.id} value={u.id}>
                {u.nombre} ({u.usuario}) — {u.rol}{u.activo ? '' : ' · inactivo'}
              </option>
            ))}
          </select>
          <input type="password" value={passNueva} onChange={e => setPassNueva(e.target.value)}
                 placeholder="Contraseña nueva" style={{ marginLeft: 8, width: 200 }} />
          <button onClick={resetearPassword}
                  disabled={cambiando || !usuarioId || passNueva.length < 4}
                  style={{ marginLeft: 8 }}>
            {cambiando ? 'Cambiando...' : 'Resetear'}
          </button>
        </div>
      </section>

      {/* --- Datos de demo -------------------------------------------------- */}
      <section style={{ marginBottom: 36 }}>
        <h2>Sembrar datos de demo</h2>
        <p style={{ maxWidth: 760, color: 'var(--texto-suave)', marginTop: 0 }}>
          Mete 12 clientes, 3 planes, 3 productos, un par de membres&iacute;as con sus
          pagos, dos ventas y una semana de asistencias, para que el dashboard tenga
          algo que dibujar. Los clientes llevan documento que empieza por <code>99</code>,
          un rango que ninguna c&eacute;dula real ocupa, para reconocerlos de un vistazo.
        </p>
        <p style={{ maxWidth: 760, color: 'var(--texto-suave)' }}>
          <b>No toca usuarios, contrase&ntilde;as, configuraci&oacute;n ni el cifrado</b>:
          solo a&ntilde;ade. Para deshacerlo, usa &quot;Vaciar datos&quot; de arriba.
        </p>

        <div style={caja()}>
          {!confirmaDemo ? (
            <button onClick={() => { setConfirmaDemo(true); setAviso(null); }}>
              Sembrar datos de demo...
            </button>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                Se van a a&ntilde;adir datos falsos <b>encima de lo que ya hay</b>
                {clientesAhora > 0 && <> &mdash; y ahora mismo hay {clientesAhora} clientes</>}.
                Antes se genera un respaldo.
              </p>
              <button onClick={sembrarDemo} disabled={sembrando}>
                {sembrando ? 'Sembrando...' : 'S\u00ed, sembrar'}
              </button>
              <button onClick={() => setConfirmaDemo(false)} disabled={sembrando} style={{ marginLeft: 8 }}>
                Cancelar
              </button>
            </>
          )}
        </div>
      </section>

      {/* --- Auditoria ------------------------------------------------------ */}
      <section style={{ marginBottom: 36 }}>
        <h2>Auditor&iacute;a</h2>
        <p style={{ maxWidth: 760, color: 'var(--texto-suave)', marginTop: 0 }}>
          Qui&eacute;n hizo qu&eacute; y cu&aacute;ndo. La app lleva tiempo escribiendo
          aqu&iacute; &mdash; accesos de desarrollador, anulaciones, ajustes de stock
          &mdash; pero hasta ahora hab&iacute;a que abrir el gym.db con una herramienta
          de SQLite para poder leerlo.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <select value={filtroAccion} onChange={e => setFiltroAccion(e.target.value)}>
            <option value="">Todas las acciones</option>
            {acciones.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input value={filtroTexto}
                 onChange={e => setFiltroTexto(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') cargarAuditoria(); }}
                 placeholder="Buscar en detalle, entidad o usuario..."
                 style={{ width: 280 }} />
          <button onClick={cargarAuditoria}>Buscar</button>
          <select value={limite} onChange={e => setLimite(Number(e.target.value))}>
            <option value={50}>&Uacute;ltimas 50</option>
            <option value={100}>&Uacute;ltimas 100</option>
            <option value={500}>&Uacute;ltimas 500</option>
          </select>
        </div>

        <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--borde-suave)', borderRadius: 'var(--radio)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--borde)' }}>
                <th style={{ paddingLeft: 10 }}>Fecha</th><th>Usuario</th><th>Acci&oacute;n</th><th>Entidad</th><th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {auditoria.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                  <td style={{ paddingLeft: 10, whiteSpace: 'nowrap' }}>{formatearFecha(a.fecha)}</td>
                  <td>{a.usuario_nombre || <span style={{ color: 'var(--texto-tenue)' }}>&mdash;</span>}</td>
                  <td>{a.accion}</td>
                  <td style={{ color: 'var(--texto-suave)' }}>
                    {a.entidad}{a.entidad_id ? ' #' + a.entidad_id : ''}
                  </td>
                  <td style={{ color: 'var(--texto-suave)', wordBreak: 'break-all' }}>{a.detalle || ''}</td>
                </tr>
              ))}
              {auditoria.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 12, color: 'var(--texto-tenue)' }}>
                  Nada que mostrar con ese filtro.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- Reset de fabrica ---------------------------------------------- */}
      <section>
        <h2 style={{ color: 'var(--error)' }}>Reset de fábrica</h2>
        <div style={caja('var(--error)')}>
          <p style={{ marginTop: 0 }}>
            Aparta la base entera y reinicia la app en el asistente de instalación,
            como recién instalada. Se van <b>todos</b> los datos, los usuarios, la
            configuración y la passphrase.
          </p>
          <p style={{ color: 'var(--aviso)' }}>
            Ojo con esto: los respaldos actuales se cifraron con la llave de esta
            instalación. Después del reset habrá una passphrase nueva y <b>esos
            respaldos ya no se podrán abrir</b>. La única vuelta atrás es la copia
            de la base que se aparta automáticamente, y que sale listada arriba
            como <code>gym.db.antes-de-reset-…</code>
          </p>
          <p style={{ marginBottom: 6, color: 'var(--texto-suave)' }}>
            Escribe <b>{PALABRA_RESET}</b> para confirmar:
          </p>
          <input value={confirmaReset} onChange={e => setConfirmaReset(e.target.value)}
                 placeholder={PALABRA_RESET} style={{ width: 160 }} />
          <button onClick={resetFabrica}
                  disabled={reseteando || confirmaReset !== PALABRA_RESET}
                  style={{ marginLeft: 8 }}>
            {reseteando ? 'Reseteando...' : 'Resetear y reiniciar'}
          </button>
        </div>
      </section>
    </div>
  );
}
