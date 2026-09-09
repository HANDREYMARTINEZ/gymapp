import { useState, useEffect } from 'react';
import SelectorImagen from '../components/SelectorImagen';

const CAMPOS_GIMNASIO = [
  { clave: 'gym_nombre', etiqueta: 'Nombre' },
  { clave: 'gym_direccion', etiqueta: 'Dirección' },
  { clave: 'gym_telefono', etiqueta: 'Teléfono' },
  { clave: 'gym_nit', etiqueta: 'NIT' },
];

const FALLOS_IMPORT = {
  falta_columna_documento: 'A ese archivo le falta la columna Documento. Sin ella no hay forma de saber si dos filas son la misma persona. Exporta primero desde aquí para ver el formato.',
  faltan_columnas: 'Ese archivo no tiene el formato esperado.',
  sin_hojas: 'El archivo no tiene ninguna hoja.',
  error_al_leer: 'No se pudo leer el archivo.',
};

function textoDeFallo(r) {
  return (FALLOS_IMPORT[r.motivo] || 'No se pudo importar: ' + r.motivo)
    + (r.detalle ? ' (' + r.detalle + ')' : '');
}

const MOTIVOS_CORREO = {
  dominio_de_ejemplo: 'dominio de ejemplo, no existe',
  con_tildes: 'lleva tildes o eñes',
  mal_escrito: 'no tiene forma de correo',
};

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

export default function Configuracion({ usuarioActual }) {
  const [datos, setDatos] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [avisoDatos, setAvisoDatos] = useState('');

  const [respaldos, setRespaldos] = useState([]);

  // Exportar / importar (5.17)
  const [trabajando, setTrabajando] = useState('');
  const [avisoExport, setAvisoExport] = useState(null);
  const [porImportar, setPorImportar] = useState(null);
  const [resultadoImport, setResultadoImport] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [avisoRespaldo, setAvisoRespaldo] = useState(null);
  // Confirmación en la propia pantalla: los diálogos nativos congelan la ventana.
  const [porRestaurar, setPorRestaurar] = useState(null);
  const [restaurando, setRestaurando] = useState(false);

  // Recordatorios de vencimiento por correo
  const [rec, setRec] = useState(null);
  const [recResumen, setRecResumen] = useState(null);
  const [recProxima, setRecProxima] = useState('');
  const [passCorreo, setPassCorreo] = useState('');
  const [verPlantillas, setVerPlantillas] = useState(false);
  const [previa, setPrevia] = useState(null);
  const [historialCorreo, setHistorialCorreo] = useState(null);
  const [trabajandoRec, setTrabajandoRec] = useState('');
  const [avisoRec, setAvisoRec] = useState(null);
  const [confirmaEnvio, setConfirmaEnvio] = useState(false);
  const [previaHtml, setPreviaHtml] = useState(null);
  const [tipoPrevia, setTipoPrevia] = useState('vencida');

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

  async function cargarRecordatorios() {
    const r = await window.api.recordatorios.estado();
    if (r.ok) { setRec(r.config); setRecResumen(r.resumen); setRecProxima(r.proxima); }
  }

  useEffect(() => { cargarDatos(); cargarRespaldos(); cargarRecordatorios(); }, []);

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

  const exportar = (formato) => async () => {
    setTrabajando(formato);
    setAvisoExport(null);
    const r = await window.api.intercambio.exportar(formato);
    setTrabajando('');
    if (r.motivo === 'cancelado') return;
    setAvisoExport(r.ok
      ? { ok: true, texto: 'Se guardaron ' + r.filas + ' filas.', ruta: r.ruta }
      : { ok: false, texto: 'No se pudo exportar: ' + (r.detalle || r.motivo) });
  };

  async function guardarRespaldoFuera() {
    setTrabajando('respaldo');
    setAvisoExport(null);
    const r = await window.api.intercambio.respaldoEn();
    setTrabajando('');
    if (r.motivo === 'cancelado') return;
    setAvisoExport(r.ok
      ? { ok: true, texto: 'Copia del respaldo guardada.', ruta: r.ruta }
      : { ok: false, texto: 'No se pudo guardar: ' + (r.detalle || r.motivo) });
  }

  async function revisarImportacion() {
    setTrabajando('revisar');
    setResultadoImport(null);
    const r = await window.api.intercambio.revisar();
    setTrabajando('');
    if (r.motivo === 'cancelado') return;
    if (!r.ok) { setResultadoImport(r); return; }
    setPorImportar(r);
  }

  async function confirmarImportacion() {
    setTrabajando('importar');
    const r = await window.api.intercambio.importarRuta({
      ruta: porImportar.ruta,
      usuarioId: usuarioActual ? usuarioActual.id : null,
    });
    setTrabajando('');
    setPorImportar(null);
    setResultadoImport(r);
    cargarRespaldos();
  }

  const cambiarRec = (campo) => (valor) => setRec(r => ({ ...r, [campo]: valor }));

  async function guardarRecordatorios() {
    setTrabajandoRec('guardar');
    setAvisoRec(null);
    const r = await window.api.recordatorios.guardar({
      config: {
        activo: rec.activo,
        cadaDias: rec.cadaDias,
        incluyePorVencer: rec.incluyePorVencer,
        remitente: rec.remitente,
        nombreRemitente: rec.nombreRemitente,
        html: rec.html,
        logo: rec.logo,
        color: rec.color,
        asuntoVencida: rec.plantillas.vencida.asunto,
        cuerpoVencida: rec.plantillas.vencida.cuerpo,
        asuntoPorVencer: rec.plantillas.por_vencer.asunto,
        cuerpoPorVencer: rec.plantillas.por_vencer.cuerpo,
      },
      // undefined = no la toques. Así guardar el resto no borra la que ya hay.
      password: passCorreo === '' ? undefined : passCorreo,
    });
    setTrabajandoRec('');
    setPassCorreo('');
    if (!r.ok) {
      setAvisoRec({ tipo: 'error', texto: r.motivo === 'cifrado_cerrado'
        ? 'No se pudo guardar la contraseña: la base está cerrada.'
        : 'No se pudo guardar: ' + r.motivo });
      return;
    }
    setAvisoRec({ tipo: 'ok', texto: 'Guardado.' });
    await cargarRecordatorios();
  }

  async function verificarCorreo() {
    setTrabajandoRec('verificar');
    setAvisoRec(null);
    const r = await window.api.recordatorios.verificar();
    setTrabajandoRec('');
    setAvisoRec(r.ok
      ? { tipo: 'ok', texto: 'Google aceptó el usuario y la contraseña.' }
      : { tipo: 'error', texto: r.motivo });
  }

  async function correoDePrueba() {
    setTrabajandoRec('prueba');
    setAvisoRec(null);
    const r = await window.api.recordatorios.prueba();
    setTrabajandoRec('');
    setAvisoRec(r.ok
      ? { tipo: 'ok', texto: 'Prueba enviada a ' + r.destino + '. Míralo en tu bandeja.' }
      : { tipo: 'error', texto: r.motivo });
  }

  async function verComoQueda(tipo) {
    setTipoPrevia(tipo);
    setTrabajandoRec('vista');
    // Se guarda primero: si no, la vista previa mostraría lo último guardado y no
    // lo que se acaba de escribir, que es justo lo que se quiere comprobar.
    await guardarRecordatorios();
    const r = await window.api.recordatorios.vistaPrevia(tipo);
    setTrabajandoRec('');
    if (r.ok) setPreviaHtml(r);
  }

  async function verPrevia() {
    setTrabajandoRec('previa');
    const r = await window.api.recordatorios.previsualizar();
    setTrabajandoRec('');
    if (r.ok) setPrevia(r);
  }

  async function verHistorialCorreo() {
    setTrabajandoRec('historial');
    const r = await window.api.recordatorios.historial(50);
    setTrabajandoRec('');
    if (r.ok) setHistorialCorreo(r.filas);
  }

  async function enviarAhora() {
    setTrabajandoRec('enviar');
    setAvisoRec(null);
    setConfirmaEnvio(false);
    const r = await window.api.recordatorios.enviarAhora();
    setTrabajandoRec('');
    if (!r.ok) {
      const textos = {
        cifrado_cerrado: 'La base está cerrada.',
        sin_remitente: 'Falta el correo del remitente.',
        sin_password: 'Falta la contraseña de aplicación.',
      };
      setAvisoRec({ tipo: 'error', texto: textos[r.motivo] || ('No se pudo enviar: ' + r.motivo) });
      return;
    }
    setAvisoRec({
      tipo: r.fallidos > 0 ? 'error' : 'ok',
      texto: r.enviados + ' correos enviados'
        + (r.fallidos > 0 ? ', ' + r.fallidos + ' fallaron' : '')
        + (r.sinCorreo > 0 ? '. ' + r.sinCorreo + ' clientes no tienen correo: hay que llamarlos' : '') + '.',
    });
    await cargarRecordatorios();
    if (r.errores && r.errores.length) setHistorialCorreo(null);
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
        {/* El logo se guarda solo al elegirlo, sin pasar por "Guardar datos":
            va a la tabla de imagenes, no a la de config. Sale en los correos de
            recordatorio. */}
        <div style={{ marginTop: 14, marginBottom: 6 }}>
          <SelectorImagen entidad="gimnasio" etiqueta="Logo del gimnasio"
                          nombre={datos.gym_nombre || 'Gym'} />
          <small style={{ color: 'var(--texto-tenue)' }}>
            Se usa en los correos de recordatorio.
          </small>
        </div>

        <button onClick={guardarDatos} disabled={guardando} style={{ marginTop: 8 }}>
          {guardando ? 'Guardando...' : 'Guardar datos'}
        </button>
        {avisoDatos && <span style={{ marginLeft: 10, color: 'var(--exito)' }}>{avisoDatos}</span>}
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2>Clientes: exportar e importar</h2>
        <p style={{ maxWidth: 640, color: 'var(--texto-suave)' }}>
          El archivo lleva una fila por membresía, con el mismo formato en los dos
          sentidos: lo que se exporta se puede volver a importar. <b>El PIN no va en
          el archivo</b> &mdash; es la clave del cliente para el kiosco y se asigna
          aquí, no en una hoja de cálculo.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={exportar('xlsx')} disabled={!!trabajando}>
            {trabajando === 'xlsx' ? 'Exportando...' : 'Exportar a Excel'}
          </button>
          <button onClick={exportar('json')} disabled={!!trabajando}>
            {trabajando === 'json' ? 'Exportando...' : 'Exportar a JSON'}
          </button>
          <button onClick={revisarImportacion} disabled={!!trabajando}>
            {trabajando === 'revisar' ? 'Leyendo...' : 'Importar desde Excel...'}
          </button>
        </div>

        {avisoExport && (
          <p style={{ marginTop: 10, color: avisoExport.ok ? 'var(--exito)' : 'var(--error)' }}>
            {avisoExport.texto}
            {avisoExport.ruta && (
              <button onClick={() => window.api.intercambio.mostrarEnCarpeta(avisoExport.ruta)}
                      style={{ marginLeft: 10 }}>
                Ver en la carpeta
              </button>
            )}
          </p>
        )}

        {/* Se mira antes de escribir. Importar toca clientes, membresias y pagos
            a la vez; saber cuantos son nuevos y cuantos se van a actualizar es lo
            que separa esto de cargar un archivo a ciegas. */}
        {porImportar && (
          <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--aviso)',
                        background: 'var(--aviso-fondo)', borderRadius: 'var(--radio)', maxWidth: 640 }}>
            <h4 style={{ marginTop: 0 }}>{porImportar.nombre}</h4>
            <p style={{ marginTop: 0 }}>
              {porImportar.filas} filas: <b>{porImportar.nuevos}</b> clientes nuevos y{' '}
              <b>{porImportar.existentes}</b> que ya existen y se van a actualizar con
              lo que diga el archivo.
              {porImportar.sinDocumento > 0 && (
                <> {porImportar.sinDocumento} filas no traen documento: entran igual, con
                   una cédula provisional que habrá que reemplazar por la real.</>
              )}
            </p>
            <button onClick={confirmarImportacion} disabled={!!trabajando}>
              {trabajando === 'importar' ? 'Importando...' : 'Sí, importar'}
            </button>
            <button onClick={() => setPorImportar(null)} disabled={!!trabajando} style={{ marginLeft: 8 }}>
              Cancelar
            </button>
          </div>
        )}

        {resultadoImport && (
          <div style={{ marginTop: 14, padding: 14, borderRadius: 'var(--radio)', maxWidth: 640,
                        border: '1px solid ' + (resultadoImport.ok ? 'var(--exito)' : 'var(--error)') }}>
            {resultadoImport.ok ? (
              <>
                <p style={{ marginTop: 0 }}>
                  Listo: <b>{resultadoImport.clientesCreados}</b> clientes nuevos,{' '}
                  <b>{resultadoImport.clientesActualizados}</b> actualizados,{' '}
                  <b>{resultadoImport.membresiasCreadas}</b> membresías creadas
                  {resultadoImport.membresiasOmitidas > 0 &&
                    <> y {resultadoImport.membresiasOmitidas} que ya estaban</>}.
                </p>
                {resultadoImport.planesCreados > 0 && (
                  <p>Se crearon {resultadoImport.planesCreados} planes que no estaban en el catálogo.</p>
                )}
                {resultadoImport.provisionales > 0 && (
                  <p style={{ color: 'var(--aviso)' }}>
                    {'⚠'} {resultadoImport.provisionales} clientes venían sin documento en
                    el archivo. Entraron igual, con una cédula provisional
                    (1234xxxx) para que puedan usar el kiosco. Salen marcados en
                    la lista de Clientes, y el kiosco avisa cada vez que uno de
                    ellos marca asistencia.
                  </p>
                )}
                {(resultadoImport.avisos || []).map((a, i) => (
                  <p key={i} style={{ color: 'var(--aviso)', margin: '4px 0' }}>{'\u26A0'} {a.plan}: {a.motivo}</p>
                ))}
                {(resultadoImport.errores || []).length > 0 && (
                  <>
                    <p style={{ color: 'var(--error)' }}>
                      {resultadoImport.errores.length} filas quedaron fuera:
                    </p>
                    <ul style={{ maxHeight: 160, overflowY: 'auto', marginTop: 0 }}>
                      {resultadoImport.errores.slice(0, 50).map((e, i) => (
                        <li key={i}>Fila {e.fila}{e.documento ? ' (' + e.documento + ')' : ''}: {e.motivo}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p style={{ color: 'var(--texto-suave)', marginBottom: 0 }}>
                  Los clientes importados todavía no tienen PIN. Asígnaselo desde Clientes
                  para que puedan entrar por el kiosco.
                </p>
              </>
            ) : (
              <p style={{ margin: 0, color: 'var(--error)' }}>{textoDeFallo(resultadoImport)}</p>
            )}
            <button onClick={() => setResultadoImport(null)} style={{ marginTop: 8 }}>Cerrar</button>
          </div>
        )}
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2>Recordatorios de vencimiento por correo</h2>
        <p style={{ maxWidth: 640, color: 'var(--texto-suave)' }}>
          Cada cierto tiempo la app le escribe a quien tiene la membresía vencida
          o a punto de vencer. Un correo por persona, con su nombre y su fecha, y
          con unos segundos de pausa entre uno y otro para que Google no lo tome
          por un robot. A quien ya se le escribió en este periodo no se le repite.
        </p>

        {!rec ? <p>Cargando...</p> : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
              <div style={{ padding: 14, border: '1px solid var(--borde)', borderRadius: 'var(--radio)',
                            background: 'var(--superficie)', minWidth: 330 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={rec.activo}
                         onChange={e => cambiarRec('activo')(e.target.checked)} />
                  <b style={{ color: 'var(--texto)' }}>Enviar recordatorios automáticamente</b>
                </label>

                <div style={{ marginTop: 12 }}>
                  <label style={{ display: 'inline-block', width: 130 }}>Cada</label>
                  <input type="number" min={1} max={90} value={rec.cadaDias}
                         onChange={e => cambiarRec('cadaDias')(Number(e.target.value))}
                         style={{ width: 70 }} /> días
                </div>

                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={rec.incluyePorVencer}
                         onChange={e => cambiarRec('incluyePorVencer')(e.target.checked)} />
                  Avisar también a los que están por vencer
                </label>

                <div style={{ marginTop: 14 }}>
                  <label style={{ display: 'block' }}>Correo desde el que se envía</label>
                  <input value={rec.remitente} placeholder="gimnasio@gmail.com"
                         onChange={e => cambiarRec('remitente')(e.target.value)}
                         style={{ width: '100%' }} />
                </div>

                <div style={{ marginTop: 8 }}>
                  <label style={{ display: 'block' }}>Nombre que verá el cliente</label>
                  <input value={rec.nombreRemitente} placeholder="Gimnasio Central"
                         onChange={e => cambiarRec('nombreRemitente')(e.target.value)}
                         style={{ width: '100%' }} />
                </div>

                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--borde-suave)' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={rec.html}
                           onChange={e => cambiarRec('html')(e.target.checked)} />
                    Correo con diseño (si no, va en texto plano)
                  </label>

                  {rec.html && (
                    <>
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={rec.logo}
                               onChange={e => cambiarRec('logo')(e.target.checked)} />
                        Poner el logo del gimnasio arriba
                      </label>
                      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <label>Color de la marca</label>
                        <input type="color" value={rec.color}
                               onChange={e => cambiarRec('color')(e.target.value)} />
                        <span style={{ color: 'var(--texto-tenue)' }}>{rec.color}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        <button onClick={() => verComoQueda('vencida')} disabled={!!trabajandoRec}>
                          {trabajandoRec === 'vista' ? 'Preparando...' : 'Ver cómo queda'}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div style={{ marginTop: 8 }}>
                  <label style={{ display: 'block' }}>
                    Contraseña de aplicación de Google
                    {rec.hayPassword && <span style={{ color: 'var(--exito)' }}> — ya hay una guardada</span>}
                  </label>
                  <input type="password" value={passCorreo}
                         placeholder={rec.hayPassword ? 'Escribe otra solo si la vas a cambiar' : 'xxxx xxxx xxxx xxxx'}
                         onChange={e => setPassCorreo(e.target.value)}
                         style={{ width: '100%' }} />
                  <small style={{ color: 'var(--texto-tenue)' }}>
                    No es la contraseña del correo. Se genera en la cuenta de Google,
                    con la verificación en dos pasos activada, y solo sirve para enviar.
                    Se guarda cifrada.
                  </small>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                  <button onClick={guardarRecordatorios} disabled={!!trabajandoRec}>
                    {trabajandoRec === 'guardar' ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button onClick={verificarCorreo} disabled={!!trabajandoRec}>
                    {trabajandoRec === 'verificar' ? 'Probando...' : 'Probar la conexión'}
                  </button>
                  <button onClick={correoDePrueba} disabled={!!trabajandoRec}>
                    {trabajandoRec === 'prueba' ? 'Enviando...' : 'Enviarme un correo de prueba'}
                  </button>
                </div>
              </div>

              {/* A quien le tocaria ahora mismo. Se ve antes de mandar nada. */}
              {recResumen && (
                <div style={{ padding: 14, border: '1px solid var(--borde)', borderRadius: 'var(--radio)',
                              background: 'var(--superficie)', minWidth: 300 }}>
                  <h4 style={{ marginTop: 0 }}>Ahora mismo</h4>
                  <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--acento-claro)' }}>
                    {recResumen.porEnviar}
                  </div>
                  <div style={{ color: 'var(--texto-suave)', marginBottom: 10 }}>
                    correos por enviar — {recResumen.vencidas} vencidas
                    {rec.incluyePorVencer && <>, {recResumen.porVencer} por vencer</>}
                  </div>

                  {recResumen.yaAvisados > 0 && (
                    <div style={{ color: 'var(--texto-tenue)' }}>
                      {recResumen.yaAvisados} ya recibieron el aviso en este periodo.
                    </div>
                  )}
                  {recResumen.sinCorreo > 0 && (
                    <div style={{ color: 'var(--aviso)', marginTop: 6 }}>
                      {'\u26A0'} {recResumen.sinCorreo} no tienen correo: a esos hay que llamarlos.
                    </div>
                  )}

                  <div style={{ marginTop: 12, color: 'var(--texto-suave)' }}>
                    Próxima ronda automática: <b>{rec.activo ? recProxima : 'desactivada'}</b>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button onClick={verPrevia} disabled={!!trabajandoRec}>
                      {trabajandoRec === 'previa' ? 'Leyendo...' : 'Ver a quién le llegaría'}
                    </button>
                    <button onClick={verHistorialCorreo} disabled={!!trabajandoRec}>
                      Ver lo ya enviado
                    </button>
                  </div>

                  {!confirmaEnvio ? (
                    <button onClick={() => { setConfirmaEnvio(true); setAvisoRec(null); }}
                            disabled={!!trabajandoRec || recResumen.porEnviar === 0}
                            style={{ marginTop: 8, width: '100%' }}>
                      Enviar la ronda ahora
                    </button>
                  ) : (
                    <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--aviso)',
                                  background: 'var(--aviso-fondo)', borderRadius: 'var(--radio)' }}>
                      <p style={{ margin: '0 0 8px' }}>
                        Se van a enviar <b>{recResumen.porEnviar}</b> correos de verdad, a
                        clientes de verdad. Tarda unos {Math.ceil(recResumen.porEnviar * 3 / 60)} minutos.
                      </p>
                      <button onClick={enviarAhora} disabled={!!trabajandoRec}>
                        {trabajandoRec === 'enviar' ? 'Enviando...' : 'Sí, enviar'}
                      </button>
                      <button onClick={() => setConfirmaEnvio(false)} disabled={!!trabajandoRec}
                              style={{ marginLeft: 8 }}>Cancelar</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {avisoRec && (
              <p style={{ color: avisoRec.tipo === 'ok' ? 'var(--exito)' : 'var(--error)', maxWidth: 640 }}>
                {avisoRec.texto}
              </p>
            )}

            {/* Plantillas. Plegadas por defecto: se tocan una vez y no se vuelven
                a mirar, y desplegadas se comen la pantalla. */}
            <button onClick={() => setVerPlantillas(v => !v)}
                    style={{ background: 'none', border: 'none', color: 'var(--acento-claro)',
                             cursor: 'pointer', padding: '10px 0' }}>
              {verPlantillas ? '▾' : '▸'} Personalizar el texto de los correos
            </button>

            {verPlantillas && (
              <div style={{ maxWidth: 640 }}>
                <p style={{ color: 'var(--texto-suave)' }}>
                  Entre llaves se sustituyen solos: <code>{'{nombre}'}</code>,{' '}
                  <code>{'{plan}'}</code>, <code>{'{fecha}'}</code>,{' '}
                  <code>{'{dias}'}</code>, <code>{'{gimnasio}'}</code>.
                </p>

                <h4>A los que ya vencieron</h4>
                <input value={rec.plantillas.vencida.asunto} style={{ width: '100%' }}
                       onChange={e => setRec(r => ({ ...r, plantillas: { ...r.plantillas,
                         vencida: { ...r.plantillas.vencida, asunto: e.target.value } } }))} />
                <textarea value={rec.plantillas.vencida.cuerpo} rows={9} style={{ width: '100%', marginTop: 6 }}
                          onChange={e => setRec(r => ({ ...r, plantillas: { ...r.plantillas,
                            vencida: { ...r.plantillas.vencida, cuerpo: e.target.value } } }))} />

                <h4 style={{ marginTop: 16 }}>A los que están por vencer</h4>
                <input value={rec.plantillas.por_vencer.asunto} style={{ width: '100%' }}
                       onChange={e => setRec(r => ({ ...r, plantillas: { ...r.plantillas,
                         por_vencer: { ...r.plantillas.por_vencer, asunto: e.target.value } } }))} />
                <textarea value={rec.plantillas.por_vencer.cuerpo} rows={9} style={{ width: '100%', marginTop: 6 }}
                          onChange={e => setRec(r => ({ ...r, plantillas: { ...r.plantillas,
                            por_vencer: { ...r.plantillas.por_vencer, cuerpo: e.target.value } } }))} />

                <p style={{ color: 'var(--texto-tenue)' }}>
                  Acuérdate de darle a Guardar.
                </p>
              </div>
            )}

            {previaHtml && (
              <div style={{ marginTop: 16, padding: 14, border: '1px solid var(--borde)',
                            borderRadius: 'var(--radio)', maxWidth: 760 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b>Así se ve el correo</b>
                  <button onClick={() => verComoQueda('vencida')}
                          disabled={!!trabajandoRec}
                          style={tipoPrevia === 'vencida' ? { borderColor: 'var(--acento)' } : {}}>
                    Vencida
                  </button>
                  <button onClick={() => verComoQueda('por_vencer')}
                          disabled={!!trabajandoRec}
                          style={tipoPrevia === 'por_vencer' ? { borderColor: 'var(--acento)' } : {}}>
                    Por vencer
                  </button>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => setPreviaHtml(null)}>Cerrar</button>
                </div>

                <p style={{ color: 'var(--texto-suave)', margin: '10px 0 4px' }}>
                  Asunto: <b style={{ color: 'var(--texto)' }}>{previaHtml.asunto}</b>
                </p>
                {!previaHtml.hayLogo && rec.logo && (
                  <p style={{ color: 'var(--aviso)', marginTop: 0 }}>
                    {'\u26A0'} Todavía no has subido el logo del gimnasio, así que el
                    correo sale con el nombre en texto. Se sube arriba del todo,
                    en "Datos del gimnasio".
                  </p>
                )}

                {/* El HTML se pinta dentro de un iframe y no en la propia página:
                    el correo trae su fondo claro y sus estilos, y sueltos aquí se
                    mezclarían con los de la app. Así se ve como lo verá el cliente. */}
                <iframe
                  title="Vista previa del correo"
                  srcDoc={previaHtml.html}
                  sandbox=""
                  style={{ width: '100%', height: 460, border: '1px solid var(--borde-suave)',
                           borderRadius: 'var(--radio)', background: '#eef1f6' }}
                />
              </div>
            )}

            {previa && (
              <div style={{ marginTop: 16, padding: 14, border: '1px solid var(--borde)',
                            borderRadius: 'var(--radio)', maxWidth: 760 }}>
                <h4 style={{ marginTop: 0 }}>
                  Les llegaría a {previa.porEnviar.length} personas
                </h4>
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--borde)' }}>
                        <th>Cliente</th><th>Correo</th><th>Estado</th><th>Vence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previa.porEnviar.map(d => (
                        <tr key={d.clienteId} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                          <td>{d.nombre}</td>
                          <td style={{ color: 'var(--texto-suave)' }}>{d.email}</td>
                          <td style={{ color: d.tipo === 'vencida' ? 'var(--error)' : 'var(--aviso)' }}>
                            {d.tipo === 'vencida' ? 'vencida' : 'por vencer'}
                          </td>
                          <td style={{ color: 'var(--texto-suave)' }}>{d.fFin || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {previa.correoInvalido && previa.correoInvalido.length > 0 && (
                  <>
                    <h4 style={{ color: 'var(--error)' }}>
                      Correo que no sirve — hay que corregirlo ({previa.correoInvalido.length})
                    </h4>
                    <p style={{ color: 'var(--texto-suave)', marginTop: 0 }}>
                      A estos no se les manda nada. Sus direcciones rebotarían, y una
                      tanda de rebotes seguidos es lo que hace que Google empiece a
                      mirar mal la cuenta. Corrígelas en la ficha de cada cliente.
                    </p>
                    <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <tbody>
                          {previa.correoInvalido.map(d => (
                            <tr key={d.clienteId} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                              <td>{d.nombre}</td>
                              <td style={{ color: 'var(--texto-suave)' }}>{d.email}</td>
                              <td style={{ color: 'var(--error)' }}>{MOTIVOS_CORREO[d.problema] || d.problema}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {previa.sinCorreo.length > 0 && (
                  <>
                    <h4 style={{ color: 'var(--aviso)' }}>
                      Sin correo — hay que llamarlos ({previa.sinCorreo.length})
                    </h4>
                    <ul style={{ color: 'var(--texto-suave)', maxHeight: 140, overflowY: 'auto', marginTop: 0 }}>
                      {previa.sinCorreo.map(d => (
                        <li key={d.clienteId}>{d.nombre} — {d.telefono || 'sin teléfono'}</li>
                      ))}
                    </ul>
                  </>
                )}
                <button onClick={() => setPrevia(null)} style={{ marginTop: 8 }}>Cerrar</button>
              </div>
            )}

            {historialCorreo && (
              <div style={{ marginTop: 16, padding: 14, border: '1px solid var(--borde)',
                            borderRadius: 'var(--radio)', maxWidth: 760 }}>
                <h4 style={{ marginTop: 0 }}>Últimos correos enviados</h4>
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <tbody>
                      {historialCorreo.map((h, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatearFecha(h.fecha)}</td>
                          <td>{h.nombre}</td>
                          <td style={{ color: 'var(--texto-suave)' }}>{h.email}</td>
                          <td style={{ color: h.ok ? 'var(--exito)' : 'var(--error)' }}>
                            {h.ok ? 'enviado' : (h.error || 'falló')}
                          </td>
                        </tr>
                      ))}
                      {historialCorreo.length === 0 && (
                        <tr><td style={{ color: 'var(--texto-tenue)' }}>Todavía no se ha enviado ninguno.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => setHistorialCorreo(null)} style={{ marginTop: 8 }}>Cerrar</button>
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <h2>Respaldos</h2>
        <p style={{ maxWidth: 620, color: 'var(--texto-suave)' }}>
          Cada respaldo es una copia cifrada de toda la base, y solo se abre con la
          passphrase de esta instalación. Se genera uno automáticamente al cerrar la
          app y se conservan los 14 más recientes.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={generarRespaldo} disabled={generando || restaurando}>
            {generando ? 'Generando...' : 'Generar respaldo ahora'}
          </button>
          {/* 5.17: hasta ahora el respaldo iba siempre a una ruta fija dentro de
              userData. Esto deja elegir donde, para poder sacarlo a una USB. */}
          <button onClick={guardarRespaldoFuera} disabled={generando || restaurando || !!trabajando}>
            {trabajando === 'respaldo' ? 'Guardando...' : 'Guardar una copia en...'}
          </button>
        </div>

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
