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
  vacio: 'no tiene correo',
  dominio_de_ejemplo: 'dominio de ejemplo, no existe',
  con_tildes: 'lleva tildes o eñes',
  mal_escrito: 'no tiene forma de correo',
};

// Las cuatro cestas del censo, en el orden en que conviene atacarlas.
const FALLOS_CENSO = ['vacio', 'dominio_de_ejemplo', 'mal_escrito', 'con_tildes'];

function faltantesDelCenso(censo) {
  return FALLOS_CENSO.flatMap(motivo => (censo[motivo] || []).map(c => ({ ...c, motivo })));
}

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

  // PIN del kiosco, en lote
  const [pines, setPines] = useState(null);
  const [pinLote, setPinLote] = useState('0000');
  const [confirmaPin, setConfirmaPin] = useState(false);
  const [pinAleatorio, setPinAleatorio] = useState(true);
  const [trabajandoPin, setTrabajandoPin] = useState(false);
  const [avisoPin, setAvisoPin] = useState(null);
  const [copiado, setCopiado] = useState('');
  // Volver a generarlos: la unica salida si la lista se pierde antes de
  // guardarla, porque los PIN no se pueden leer una vez guardados.
  const [regenerar, setRegenerar] = useState(false);

  // Recordatorios de vencimiento por correo
  const [rec, setRec] = useState(null);
  const [recResumen, setRecResumen] = useState(null);
  const [censo, setCenso] = useState(null);
  const [verSinCorreo, setVerSinCorreo] = useState(false);
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
    if (r.ok) { setRec(r.config); setRecResumen(r.resumen); setRecProxima(r.proxima); setCenso(r.censo); }
  }

  async function cargarPines() {
    setPines(await window.api.clientes.pinesResumen());
  }

  // El portapapeles lo escribe el proceso principal: aqui navigator.clipboard
  // no funciona, y no es cosa de arreglarlo aflojando permisos -- main.js le
  // niega a proposito todo salvo la camara.
  async function copiarListaPin() {
    const texto = ['Cliente\tDocumento\tPIN']
      .concat(avisoPin.generados.map(g => g.nombre + '\t' + g.documento + '\t' + g.pin))
      .join('\n');
    const r = await window.api.sistema.copiar(texto);
    setCopiado(r.ok ? 'Copiado: ' + avisoPin.generados.length + ' líneas. Péguelas ya en el Bloc de notas.'
                    : 'No se pudo copiar. Selecciónela con el ratón y use Ctrl+C.');
  }

  async function asignarPinEnLote() {
    setTrabajandoPin(true);
    setAvisoPin(null);
    const r = await window.api.clientes.asignarPinEnLote({
      pin: pinLote, aleatorio: pinAleatorio, incluirConPin: regenerar,
      usuarioId: usuarioActual ? usuarioActual.id : null,
    });
    setTrabajandoPin(false);
    setConfirmaPin(false);
    setAvisoPin(r);
    setCopiado('');
    setRegenerar(false);
    cargarPines();
  }

  useEffect(() => {
    cargarDatos(); cargarRespaldos(); cargarRecordatorios(); cargarPines();
  }, []);

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
    // Importar es justamente lo que hace subir el censo: se vuelve a contar sin
    // que haya que recargar la pantalla, que es como se ve si la hoja sirvio.
    cargarRecordatorios();
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

        {/* El censo de correos. Los recordatorios de vencimiento están hechos y
            probados, pero hoy no le llegan a nadie porque la importación metió
            direcciones @example.com inventadas. Esto responde de un vistazo a
            "¿cuántos correos me faltan por conseguir?", que antes había que
            mirar cliente a cliente. El camino: exportar, rellenar la columna
            Correo, volver a importar — el importador reconoce a cada cliente por
            su documento y actualiza, no duplica. */}
        {censo && (
          <div style={{ marginBottom: 14, padding: 14, maxWidth: 640,
                        borderRadius: 'var(--radio)',
                        border: '1px solid ' + (censo.porConseguir > 0 ? 'var(--aviso)' : 'var(--exito)'),
                        background: censo.porConseguir > 0 ? 'var(--aviso-fondo)' : 'transparent' }}>
            <b>Correos: {censo.utilizables} de {censo.total} clientes activos</b>
            {' '}se pueden avisar por correo.
            {censo.porConseguir > 0 ? (
              <>
                <div style={{ marginTop: 6 }}>
                  Faltan <b>{censo.porConseguir}</b>. Se arreglan sin escribirlos uno a uno:
                  exporta a Excel, rellena la columna <b>Correo</b> y vuelve a importar
                  esa misma hoja — cada cliente se reconoce por su documento, así que
                  se actualiza y no se duplica.
                </div>
                <div style={{ marginTop: 6, color: 'var(--texto-suave)' }}>
                  {FALLOS_CENSO
                    .filter(m => (censo[m] || []).length > 0)
                    .map(m => censo[m].length + ' ' + MOTIVOS_CORREO[m])
                    .join(' · ')}
                </div>
                <button onClick={() => setVerSinCorreo(v => !v)} style={{ marginTop: 10 }}>
                  {verSinCorreo ? 'Ocultar la lista' : 'Ver quiénes son'}
                </button>
                {verSinCorreo && (
                  <div style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <tbody>
                        {faltantesDelCenso(censo).map(c => (
                          <tr key={c.clienteId}>
                            <td style={{ padding: '3px 6px 3px 0' }}>{c.nombre}</td>
                            <td style={{ padding: '3px 6px', color: 'var(--texto-tenue)' }}>{c.documento}</td>
                            <td style={{ padding: '3px 6px', color: 'var(--texto-suave)' }}>
                              {c.email || '—'}
                            </td>
                            <td style={{ padding: '3px 0', color: 'var(--aviso)' }}>
                              {MOTIVOS_CORREO[c.motivo]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div style={{ marginTop: 6, color: 'var(--texto-suave)' }}>
                Ninguno queda fuera de los recordatorios por culpa del correo.
              </div>
            )}
          </div>
        )}

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
            {/* Las filas sin documento no se pueden clasificar en nuevas o
                existentes -- se emparejan por cedula, y no la traen -- asi que
                se cuentan aparte. Decir "0 clientes nuevos" cuando van a entrar
                27 asustaba con razon: aqui se dice cuantos van a entrar de cada
                forma, sin ceros que no significan lo que parecen. */}
            <p style={{ marginTop: 0 }}>
              {porImportar.filas} filas.{' '}
              {porImportar.nuevos > 0 && (
                <><b>{porImportar.nuevos}</b> clientes nuevos.{' '}</>
              )}
              {porImportar.existentes > 0 && (
                <><b>{porImportar.existentes}</b> ya existen y se van a actualizar con lo que
                  diga el archivo.{' '}</>
              )}
              {porImportar.sinDocumento > 0 && (
                <><b>{porImportar.sinDocumento}</b> filas no traen documento: entran como
                  clientes nuevos, con una cédula provisional que habrá que reemplazar por
                  la real.</>
              )}
              {porImportar.nuevos === 0 && porImportar.existentes === 0 &&
               porImportar.sinDocumento === 0 && (
                <>No hay ninguna fila con datos que importar.</>
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

      {/* El PIN en lote. Los clientes que entraron por el Excel llegaron sin PIN
          -- el archivo no lo lleva a proposito -- y sin PIN no pueden marcar
          asistencia. Ponerselo uno a uno es una tarde entera. */}
      <section style={{ marginBottom: 40 }}>
        <h2>PIN del kiosco</h2>
        <p style={{ maxWidth: 640, color: 'var(--texto-suave)' }}>
          En el kiosco el cliente teclea los <b>últimos 4 dígitos de su documento</b> y
          después su PIN. Quien no tenga PIN no puede marcar asistencia.
        </p>

        {pines && (
          <div style={{ marginBottom: 12, padding: 14, maxWidth: 640,
                        borderRadius: 'var(--radio)',
                        border: '1px solid ' + (pines.sinPin > 0 ? 'var(--aviso)' : 'var(--exito)'),
                        background: pines.sinPin > 0 ? 'var(--aviso-fondo)' : 'transparent' }}>
            <b>PIN: {pines.conPin} de {pines.activos} clientes activos</b>
            {pines.sinPin > 0 ? (
              <div style={{ marginTop: 6 }}>
                Faltan <b>{pines.sinPin}</b>, que hoy no pueden entrar por el kiosco.
              </div>
            ) : (
              <div style={{ marginTop: 6, color: 'var(--texto-suave)' }}>
                Todos los clientes activos tienen PIN.
              </div>
            )}
          </div>
        )}

        {/* Si la lista se perdio antes de guardarla no hay forma de recuperarla:
            los PIN se guardan cifrados. Lo unico que se puede hacer es generar
            otros nuevos, y para eso hay que poder tocar a los que YA tienen. */}
        {pines && pines.conPin > 0 && !confirmaPin && (
          <div style={{ marginTop: 10 }}>
            {!regenerar ? (
              <button onClick={() => { setRegenerar(true); setPinAleatorio(true); setAvisoPin(null); }}>
                Volver a generar los PIN de los {pines.conPin} que ya tienen
              </button>
            ) : (
              <div style={{ padding: 12, maxWidth: 640, borderRadius: 'var(--radio)',
                            border: '1px solid var(--aviso)', background: 'var(--aviso-fondo)' }}>
                <p style={{ marginTop: 0 }}>
                  Se le dará un PIN nuevo a <b>los {pines.activos} clientes activos</b>, también a
                  los que ya tenían uno. <b>El PIN que tuvieran deja de servir.</b> Úselo solo si
                  perdió la lista antes de guardarla.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirmaPin(true)}>Sí, generarlos de nuevo</button>
                  <button onClick={() => setRegenerar(false)}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        )}

        {pines && pines.sinPin > 0 && !confirmaPin && (
          <div>
            {/* Dos formas, y la de por defecto es la buena: un PIN distinto por
                persona. El comun sirve para arrancar en un dia, pero cualquiera
                que sepa los 4 ultimos digitos de otro puede marcar por el. */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>
                <input type="radio" checked={pinAleatorio}
                       onChange={() => { setPinAleatorio(true); setAvisoPin(null); }} />
                {' '}Un PIN distinto para cada uno <b>(recomendado)</b>
                <div style={{ marginLeft: 22, fontSize: 12, color: 'var(--texto-tenue)' }}>
                  Se genera al azar y la lista sale en pantalla <b>una sola vez</b>, para
                  imprimirla. Después ya no se puede consultar ninguno.
                </div>
              </label>
              <label style={{ display: 'block' }}>
                <input type="radio" checked={!pinAleatorio}
                       onChange={() => { setPinAleatorio(false); setAvisoPin(null); }} />
                {' '}El mismo PIN para todos
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {!pinAleatorio && (
                <>
                  <label>PIN:</label>
                  <input value={pinLote} maxLength={4} inputMode="numeric"
                         onChange={e => { setPinLote(e.target.value.replace(/\D/g, '')); setAvisoPin(null); }}
                         style={{ width: 70, letterSpacing: 4, textAlign: 'center' }} />
                </>
              )}
              <button onClick={() => setConfirmaPin(true)}
                      disabled={!pinAleatorio && !/^\d{4}$/.test(pinLote)}>
                Asignárselo a los {pines.sinPin} que no tienen
              </button>
            </div>
          </div>
        )}

        {confirmaPin && (
          <div style={{ padding: 14, maxWidth: 640, borderRadius: 'var(--radio)',
                        border: '1px solid var(--aviso)', background: 'var(--aviso-fondo)' }}>
            <p style={{ marginTop: 0 }}>
              {pinAleatorio
                ? <>¿Generar un PIN distinto para cada uno de los <b>{pines.sinPin}</b> clientes
                    que no tienen ninguno?</>
                : <>¿Ponerle el PIN <b>{pinLote}</b> a los <b>{pines.sinPin}</b> clientes que no
                    tienen ninguno?</>}
            </p>
            <p style={{ color: 'var(--texto-suave)' }}>
              A quien ya tenga PIN <b>no se le toca</b>.{' '}
              {pinAleatorio
                ? <>La lista de PIN aparecerá aquí <b>una sola vez</b>: se guardan cifrados y
                    no se pueden volver a consultar. Imprímala o cópiela antes de cerrar
                    esta pantalla.</>
                : <>Como el PIN sería el mismo para todos ellos, sirve para empezar a marcar
                    asistencia hoy, pero cualquiera que se sepa los últimos 4 dígitos de otro
                    podría marcar por él.</>}
              {' '}Cada cliente puede cambiarlo después desde su ficha.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={asignarPinEnLote} disabled={trabajandoPin}>
                {trabajandoPin ? 'Asignando...'
                  : (pinAleatorio ? 'Sí, generar los PIN' : 'Sí, asignar el PIN ' + pinLote)}
              </button>
              <button onClick={() => setConfirmaPin(false)} disabled={trabajandoPin}>Cancelar</button>
            </div>
          </div>
        )}

        {avisoPin && (
          <div style={{ marginTop: 10, maxWidth: 640 }}>
            {avisoPin.ok ? (
              <>
                <p style={{ color: 'var(--exito)', marginBottom: 6 }}>
                  Listo: {avisoPin.asignados} cliente{avisoPin.asignados === 1 ? '' : 's'} con PIN.
                </p>

                {/* La unica vez que estos numeros se van a ver. Se quedan en
                    pantalla hasta que se recargue: no se guardan en ningun
                    sitio en claro, ni siquiera en auditoria. */}
                {(avisoPin.generados || []).length > 0 && (
                  <div style={{ padding: 12, marginBottom: 10, borderRadius: 'var(--radio)',
                                border: '1px solid var(--acento)' }}>
                    <b>Apunte o imprima esta lista ahora.</b> No se puede volver a ver.
                    <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ textAlign: 'left' }}>
                            <th>Cliente</th><th>Documento</th><th>PIN</th>
                          </tr>
                        </thead>
                        <tbody>
                          {avisoPin.generados.map(g => (
                            <tr key={g.id}>
                              <td>{g.nombre}</td>
                              <td style={{ color: 'var(--texto-tenue)' }}>{g.documento}</td>
                              <td style={{ letterSpacing: 3 }}><b>{g.pin}</b></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center',
                                  flexWrap: 'wrap' }}>
                      <button onClick={copiarListaPin}>Copiar la lista</button>
                      {copiado && <span style={{ color: 'var(--exito)' }}>{copiado}</span>}
                    </div>
                  </div>
                )}
                {/* Dos clientes con los mismos 4 dígitos finales Y el mismo PIN son
                    indistinguibles para el kiosco, que se quedaría con el primero. */}
                {(avisoPin.choques || []).length > 0 && (
                  <div style={{ padding: 12, borderRadius: 'var(--radio)',
                                border: '1px solid var(--error)' }}>
                    <b>Ojo: {avisoPin.choques.length} grupo(s) comparten los últimos 4
                    dígitos.</b> Con el mismo PIN el kiosco no puede distinguirlos; dele a
                    uno de cada grupo un PIN distinto desde su ficha:
                    <ul style={{ marginBottom: 0 }}>
                      {avisoPin.choques.map(ch => (
                        <li key={ch.ult4}>
                          …{ch.ult4}: {ch.clientes.map(c => c.nombre).join(', ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--error)' }}>
                {avisoPin.motivo === 'pin_invalido'
                  ? 'El PIN tiene que ser de exactamente 4 dígitos.'
                  : 'No se pudo asignar: ' + avisoPin.motivo}
              </p>
            )}
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
                  {/* Los dos numeros de arriba son de la ronda de hoy. Este es el
                      del gimnasio entero, y es el que dice si esta pantalla sirve
                      de algo: con 0 correos utilizables, la ronda no le llega a
                      nadie por muy bien configurada que este. */}
                  {censo && censo.porConseguir > 0 && (
                    <div style={{ color: 'var(--texto-tenue)', marginTop: 6 }}>
                      En total, {censo.utilizables} de {censo.total} clientes tienen un
                      correo al que se pueda escribir. Los otros {censo.porConseguir} se
                      arreglan desde <b>Clientes: exportar e importar</b>, más arriba.
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
