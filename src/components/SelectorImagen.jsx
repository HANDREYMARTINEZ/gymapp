import { useState, useEffect, useRef } from 'react';

// Selector de imagen para cualquier cosa que lleve una: cliente, producto o el
// logo del gimnasio. Habla con window.api.imagenes, que es el unico sitio del
// proyecto donde se guardan imagenes.
//
// Dos formas de conseguir la imagen: un archivo del disco, o la camara del PC de
// recepcion. Lo segundo es lo normal con un cliente nuevo delante del mostrador:
// nadie le va a pedir que mande la foto por WhatsApp primero.
//
// Y dos modos de guardarla. Con entidadId guarda en el acto, porque la cosa ya
// existe en la base y tiene a que colgarse. Sin entidadId (un cliente que aun no
// se ha creado) se queda en memoria y avisa al padre por onCambio, para que la
// suba en cuanto tenga el id.

const LADO = 96;

function iniciales(nombre) {
  return (nombre || '')
    .trim().split(/\s+/).slice(0, 2)
    .map(p => p[0] || '')
    .join('')
    .toUpperCase() || '?';
}

const MOTIVOS = {
  sin_dek: 'La base está bloqueada.',
  no_es_imagen: 'Ese archivo no es una imagen.',
  muy_grande: 'La imagen pesa demasiado.',
  vacia: 'El archivo está vacío.',
  entidad_invalida: 'No se puede asociar la imagen a eso.',
};

// La camara elegida se guarda en la config de la instalacion y no en el
// navegador: es una propiedad de ESTE mostrador -- "usa la webcam de arriba, no
// la del movil" -- y asi viaja en los respaldos y sobrevive a cualquier limpieza
// del perfil de Electron.
const CLAVE_CAMARA = 'camara_preferida';

// Se guardan el id y la etiqueta. El id es lo rapido, pero Chromium lo cambia si
// la camara se enchufa en otro puerto; cuando eso pasa se la reconoce por su
// nombre en vez de volver a la ruleta de la camara por defecto.
async function leerCamaraPreferida() {
  try {
    const guardado = await window.api.config.get(CLAVE_CAMARA);
    return guardado ? JSON.parse(guardado) : null;
  } catch (e) {
    return null;
  }
}

function guardarCamaraPreferida(id, etiqueta) {
  try {
    window.api.config.set(CLAVE_CAMARA, JSON.stringify({ id, etiqueta: etiqueta || '' }));
  } catch (e) {
    // Que no se pueda recordar no es motivo para no dejar tomar la foto.
  }
}

async function listarCamaras() {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    return todos.filter(d => d.kind === 'videoinput');
  } catch (e) {
    return [];
  }
}

// El mensaje importa tanto como el fallo: antes, cualquier error que no fuera de
// permisos decia "no se encontro ninguna camara conectada", y en un PC con tres
// camaras eso manda a buscar un cable cuando el problema es otro.
function mensajeDeCamara(e, cuantas) {
  const nombre = e && e.name;
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
    return 'Windows no dejó usar la cámara. Revisa los permisos de cámara del sistema.';
  }
  if (cuantas === 0 || nombre === 'NotFoundError' || nombre === 'DevicesNotFoundError') {
    return 'No hay ninguna cámara conectada a este equipo.';
  }
  if (nombre === 'NotReadableError' || nombre === 'TrackStartError' || nombre === 'AbortError') {
    return cuantas > 1
      ? 'Ninguna de las cámaras pudo arrancar. Suele ser una cámara virtual (el móvil como webcam, OBS) sin su programa abierto, u otra aplicación usándola.'
      : 'La cámara no pudo arrancar: puede estar ocupada por otro programa, o ser una cámara virtual sin su programa abierto.';
  }
  if (nombre === 'OverconstrainedError') {
    return 'La cámara no acepta el tamaño de imagen que pide la app.';
  }
  return 'No se pudo abrir la cámara' + (nombre ? ' (' + nombre + ')' : '') + '.';
}

export default function SelectorImagen({ entidad, entidadId = null, nombre = '', etiqueta = 'Foto', onCambio }) {
  // El logo del gimnasio es el unico caso en que "sin id" no significa "todavia
  // no existe": su fila lleva entidad_id NULL a proposito, porque el gimnasio es
  // uno solo. Sin esta distincion el logo no se cargaba nunca y al elegirlo se
  // quedaba en memoria en vez de guardarse.
  const guardaYa = entidad === 'gimnasio' || entidadId != null;
  const [url, setUrl] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [camara, setCamara] = useState(false);
  const [camaras, setCamaras] = useState([]);
  // Aparte de 'ocupado', que es el de guardar: mientras se busca camara el otro
  // boton decia "Guardando..." sin estar guardando nada.
  const [abriendo, setAbriendo] = useState(false);
  const [camaraEnUso, setCamaraEnUso] = useState(null);
  // Cambia con cada flujo nuevo. Sin esto, cambiar de camara con el panel ya
  // abierto no volveria a enganchar el video: el efecto solo miraba 'camara'.
  const [revision, setRevision] = useState(0);
  const archivoRef = useRef(null);
  const videoRef = useRef(null);
  const flujoRef = useRef(null);

  useEffect(() => {
    let vigente = true;
    if (!guardaYa) { setUrl(null); return; }
    window.api.imagenes.obtener(entidad, entidadId).then(u => { if (vigente) setUrl(u); });
    return () => { vigente = false; };
  }, [entidad, entidadId]);

  // Apagar la camara es obligatorio, no cosmetico: sin esto la luz del portatil
  // se queda encendida despues de cerrar el formulario.
  function apagarCamara() {
    if (flujoRef.current) {
      flujoRef.current.getTracks().forEach(t => t.stop());
      flujoRef.current = null;
    }
    setCamara(false);
  }

  useEffect(() => apagarCamara, []);

  async function guardarBase64(base64) {
    if (!guardaYa) {
      setUrl(base64);
      onCambio && onCambio(base64);
      return;
    }
    setOcupado(true);
    const r = await window.api.imagenes.guardar({ entidad, entidadId, base64 });
    setOcupado(false);
    if (!r.ok) {
      setError(MOTIVOS[r.motivo] || 'No se pudo guardar la imagen.');
      return;
    }
    setUrl(await window.api.imagenes.obtener(entidad, entidadId));
    onCambio && onCambio(base64);
  }

  function elegir(e) {
    const archivo = e.target.files && e.target.files[0];
    // Se limpia el input para que elegir dos veces el mismo archivo vuelva a
    // disparar el change; si no, la segunda vez no pasa nada.
    e.target.value = '';
    if (!archivo) return;

    setError('');
    const lector = new FileReader();
    lector.onload = () => guardarBase64(String(lector.result));
    lector.onerror = () => setError('No se pudo leer el archivo.');
    lector.readAsDataURL(archivo);
  }

  // deviceId null = "la que quiera el sistema", que es lo que hacia la app antes.
  function pedirFlujo(deviceId) {
    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
      : { width: 640, height: 480 };
    return navigator.mediaDevices.getUserMedia({ video });
  }

  // Enganchar el flujo y dejar constancia de que camara acabo dando imagen.
  async function usarFlujo(flujo) {
    flujoRef.current = flujo;
    const pista = flujo.getVideoTracks()[0];
    const ajustes = pista && pista.getSettings ? pista.getSettings() : {};
    if (ajustes.deviceId) {
      setCamaraEnUso(ajustes.deviceId);
      guardarCamaraPreferida(ajustes.deviceId, pista ? pista.label : '');
    }
    // Las etiquetas de las camaras solo llegan una vez concedido el permiso, asi
    // que la lista se refresca ahora y no antes: si no, el desplegable saldria
    // con tres "Cámara" sin nombre.
    setCamaras(await listarCamaras());
    setRevision(r => r + 1);
    setCamara(true);
  }

  // Abrir la camara en este mostrador no es "pedir la camara": puede haber
  // varias, y la que Windows entrega primero puede ser una virtual -- el movil
  // como webcam, OBS -- que no arranca si su programa no esta transmitiendo.
  // Por eso se prueban en orden: la recordada, la del sistema, y luego una por
  // una hasta que alguna de imagen.
  async function abrirCamara() {
    setError('');
    setAbriendo(true);

    const disponibles = await listarCamaras();
    const preferida = await leerCamaraPreferida();
    const porEtiqueta = preferida && preferida.etiqueta
      ? disponibles.find(d => d.label === preferida.etiqueta)
      : null;

    const orden = [];
    if (preferida && preferida.id) orden.push(preferida.id);
    if (porEtiqueta && !orden.includes(porEtiqueta.deviceId)) orden.push(porEtiqueta.deviceId);
    orden.push(null);                                    // la de por defecto
    for (const d of disponibles) {
      if (!orden.includes(d.deviceId)) orden.push(d.deviceId);
    }

    let ultimoError = null;
    for (const id of orden) {
      try {
        const flujo = await pedirFlujo(id);
        setAbriendo(false);
        await usarFlujo(flujo);
        return;
      } catch (e) {
        ultimoError = e;
        // Sin permiso no hay nada que reintentar: las demas fallarian igual.
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break;
      }
    }

    setAbriendo(false);
    setCamaras(disponibles);
    setError(mensajeDeCamara(ultimoError, disponibles.length));
  }

  // Cambiar de camara con el panel abierto: se apaga la anterior antes de pedir
  // la nueva, o en Windows la segunda llega ocupada por la primera.
  async function cambiarCamara(deviceId) {
    setError('');
    if (flujoRef.current) {
      flujoRef.current.getTracks().forEach(t => t.stop());
      flujoRef.current = null;
    }
    setListaParaCapturar(false);
    try {
      await usarFlujo(await pedirFlujo(deviceId));
    } catch (e) {
      setError(mensajeDeCamara(e, camaras.length));
      setCamara(false);
    }
  }

  // El <video> no existe hasta que React pinta el panel de la camara, asi que el
  // stream se engancha aqui y no justo despues de pedirlo. Antes se hacia con un
  // setTimeout(0) y la referencia podia seguir vacia: la camara se encendia y el
  // recuadro se quedaba en negro.
  useEffect(() => {
    if (!camara || !videoRef.current || !flujoRef.current) return;
    const video = videoRef.current;
    video.srcObject = flujoRef.current;
    const intento = video.play();
    if (intento && intento.catch) {
      intento.catch(() => setError('La cámara no arrancó. Ciérrala y vuelve a intentarlo.'));
    }
    // 'revision' cambia con cada flujo nuevo: sin ella, cambiar de camara con el
    // panel ya abierto dejaba el recuadro con la imagen de la anterior.
  }, [camara, revision]);

  // Capturar antes de que lleguen los primeros fotogramas daria una imagen negra.
  // El boton espera a que el video diga que tiene algo que mostrar.
  const [listaParaCapturar, setListaParaCapturar] = useState(false);
  useEffect(() => { if (!camara) setListaParaCapturar(false); }, [camara]);

  function capturar() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      // Antes esto salia sin hacer nada y parecia que el boton no respondia.
      setError('La cámara todavía no ha dado imagen. Espera un segundo y vuelve a intentarlo.');
      return;
    }
    const lienzo = document.createElement('canvas');
    lienzo.width = video.videoWidth;
    lienzo.height = video.videoHeight;
    lienzo.getContext('2d').drawImage(video, 0, 0);
    const base64 = lienzo.toDataURL('image/jpeg', 0.92);
    apagarCamara();
    guardarBase64(base64);
  }

  async function quitar() {
    setError('');
    if (entidadId != null) {
      setOcupado(true);
      await window.api.imagenes.eliminar(entidad, entidadId);
      setOcupado(false);
    }
    setUrl(null);
    onCambio && onCambio(null);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ display: 'block', marginBottom: 6 }}>{etiqueta}</label>

      {camara ? (
        <div style={{ maxWidth: 320 }}>
          <video ref={videoRef} autoPlay muted playsInline
                 onLoadedMetadata={() => setListaParaCapturar(true)}
                 style={{ width: '100%', borderRadius: 'var(--radio)', background: '#000', display: 'block' }} />
          {/* El desplegable solo aparece si de verdad hay donde elegir. La
              elegida se recuerda, asi que esto se toca una vez por mostrador. */}
          {camaras.length > 1 && (
            <select value={camaraEnUso || ''} onChange={e => cambiarCamara(e.target.value)}
                    style={{ width: '100%', marginTop: 8 }}>
              {camaras.map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || 'Cámara ' + (i + 1)}
                </option>
              ))}
            </select>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={capturar} disabled={!listaParaCapturar}>
              {listaParaCapturar ? 'Capturar' : 'Enfocando...'}
            </button>
            <button type="button" onClick={apagarCamara}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{
            width: LADO, height: LADO, flexShrink: 0, borderRadius: '50%', overflow: 'hidden',
            background: 'var(--superficie-alta)', border: '1px solid var(--borde)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 30, fontWeight: 700, color: 'var(--texto-tenue)',
          }}>
            {url
              ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : iniciales(nombre)}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input ref={archivoRef} type="file" accept="image/*" onChange={elegir} style={{ display: 'none' }} />
            <button type="button" onClick={abrirCamara} disabled={ocupado || abriendo}>
              {abriendo ? 'Buscando cámara...' : '📷 Tomar foto'}
            </button>
            <button type="button" onClick={() => archivoRef.current?.click()} disabled={ocupado || abriendo}>
              {ocupado ? 'Guardando...' : url ? 'Cambiar archivo' : 'Elegir archivo'}
            </button>
            {url && (
              <button type="button" onClick={quitar} disabled={ocupado}>Quitar imagen</button>
            )}
          </div>
        </div>
      )}

      {error && <p style={{ color: 'var(--error)', marginBottom: 0 }}>{error}</p>}
    </div>
  );
}
