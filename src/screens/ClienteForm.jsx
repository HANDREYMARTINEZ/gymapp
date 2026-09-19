import { useState, useEffect } from 'react';
import SelectorImagen from '../components/SelectorImagen';

const DEDO = 'indice_derecho';

export default function ClienteForm({ clienteExistente, onGuardado, onCancelar }) {
  const [form, setForm] = useState({
    documento: '', nombre: '', telefono: '', email: '',
    f_nacimiento: '', contacto_emg: '',
  });
  // Las notas ya no se editan (5.11 cambia ese campo por la foto), pero lo que
  // hubiera escrito antes no se tira: se guarda tal cual estaba.
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // El PIN del kiosco. No se puede leer (esta con argon2), solo se sabe si lo
  // tiene o no; por eso el panel ofrece asignar o cambiar, nunca "ver".
  const [tienePin, setTienePin] = useState(null);
  const [panelPin, setPanelPin] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [mensajePin, setMensajePin] = useState('');
  const [guardandoPin, setGuardandoPin] = useState(false);

  const [huellas, setHuellas] = useState(null); // null = todavia no se sabe
  const [enrolando, setEnrolando] = useState(false);
  const [mensajeHuella, setMensajeHuella] = useState('');

  // De un cliente nuevo no hay id al que colgar la foto, asi que se guarda aqui
  // y se sube en cuanto crear() devuelve el id.
  const [fotoPendiente, setFotoPendiente] = useState(null);

  useEffect(() => {
    if (!clienteExistente) return;
    setForm({
      documento: clienteExistente.documento || '',
      nombre: clienteExistente.nombre || '',
      telefono: clienteExistente.telefono || '',
      email: clienteExistente.email || '',
      f_nacimiento: clienteExistente.f_nacimiento || '',
      contacto_emg: clienteExistente.contacto_emg || '',
    });
    setNotas(clienteExistente.notas || '');
  }, [clienteExistente]);

  async function cargarHuellas() {
    if (!clienteExistente) { setHuellas([]); return; }
    setHuellas(await window.api.huellas.listarPorCliente(clienteExistente.id));
  }

  useEffect(() => { cargarHuellas(); }, [clienteExistente]);

  async function cargarPin() {
    if (!clienteExistente) { setTienePin(false); return; }
    setTienePin(await window.api.clientes.tienePin(clienteExistente.id));
  }

  useEffect(() => { cargarPin(); }, [clienteExistente]);

  async function guardarPin() {
    if (!/^\d{4}$/.test(pin)) { setMensajePin('El PIN son exactamente 4 dígitos.'); return; }
    // Se pide dos veces porque no hay forma de recuperarlo despues: si se teclea
    // mal, el cliente se queda sin poder entrar y nadie sabe por que.
    if (pin !== pin2) { setMensajePin('Los dos PIN no coinciden.'); return; }

    setGuardandoPin(true);
    const r = await window.api.clientes.asignarPin(clienteExistente.id, pin);
    setGuardandoPin(false);
    if (r && r.ok === false) { setMensajePin('No se pudo guardar: ' + r.motivo); return; }

    setPin(''); setPin2(''); setPanelPin(false);
    setMensajePin('PIN guardado.');
    cargarPin();
  }

  async function quitarPin() {
    setGuardandoPin(true);
    await window.api.clientes.quitarPin(clienteExistente.id);
    setGuardandoPin(false);
    setPin(''); setPin2(''); setPanelPin(false);
    setMensajePin('PIN eliminado. Este cliente ya no puede entrar por el kiosco con clave.');
    cargarPin();
  }

  function cambiar(campo, valor) {
    setForm({ ...form, [campo]: valor });
    setError('');
  }

  const tieneHuella = Array.isArray(huellas) && huellas.length > 0;

  async function enrolarHuella() {
    setMensajeHuella('');
    setEnrolando(true);
    const r = await window.api.huellas.enrolar(clienteExistente.id, DEDO);
    setEnrolando(false);
    if (!r || r.ok === false) {
      setMensajeHuella(r && r.motivo === 'sidecar_ajeno'
        ? 'Hay otro programa del lector abierto (por ejemplo desde Visual Studio). Ciérralo y vuelve a intentarlo.'
        : 'No se pudo leer la huella. Revisa que el lector esté conectado.');
      return;
    }
    setMensajeHuella('Huella guardada.');
    cargarHuellas();
  }

  async function eliminarHuella() {
    await window.api.huellas.eliminar(clienteExistente.id, DEDO);
    setMensajeHuella('Huella eliminada.');
    cargarHuellas();
  }

  // La cedula es UNIQUE. Antes, guardar una repetida rechazaba la promesa y
  // este formulario se quedaba en "Guardando..." para siempre, con el boton de
  // Cancelar tambien bloqueado: habia que salir por el menu y volver a
  // escribirlo todo. Ahora el proceso principal contesta con el nombre de quien
  // ya la tiene, que casi siempre es la misma persona ya registrada.
  function avisoDuplicado(r) {
    const quien = r.nombre ? '«' + r.nombre + '»' : 'otro cliente';
    return 'Esa cédula ya es de ' + quien
      + (r.activo === false ? ', que está dado de baja (búscalo en “dados de baja” y vuelve a darle de alta).' : '. Búscalo en la lista en vez de crearlo otra vez.');
  }

  async function guardar() {
    if (!form.nombre.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setGuardando(true);
    try {
      if (clienteExistente) {
        const r = await window.api.clientes.editar(clienteExistente.id, { ...form, notas, foto: null });
        if (r && r.ok === false) {
          setError(r.motivo === 'documento_duplicado' ? avisoDuplicado(r) : 'No se pudo guardar: ' + r.motivo);
          return;
        }
      } else {
        const r = await window.api.clientes.crear({ ...form, notas: null });
        if (r && r.ok === false) {
          setError(r.motivo === 'documento_duplicado' ? avisoDuplicado(r) : 'No se pudo guardar: ' + r.motivo);
          return;
        }
        if (fotoPendiente) {
          await window.api.imagenes.guardar({ entidad: 'cliente', entidadId: r, base64: fotoPendiente });
        }
      }
    } catch (e) {
      // Cualquier otro fallo del proceso principal. Se dice y se devuelve el
      // formulario: lo que no puede pasar es que se quede colgado.
      setError('No se pudo guardar: ' + (e && e.message ? e.message : e));
      return;
    } finally {
      setGuardando(false);
    }
    onGuardado();
  }

  return (
    <div style={{ border: '1px solid var(--borde)', borderRadius: 'var(--radio)', padding: 20, maxWidth: 440, marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>{clienteExistente ? 'Editar cliente' : 'Nuevo cliente'}</h3>

      <input placeholder="Documento" value={form.documento} onChange={e => cambiar('documento', e.target.value)} style={{ width: '100%' }} />
      {/* Se avisa antes de guardar y no despues: el mostrador tiene al cliente
          delante, y es el momento de pedirle la cedula. Si aun asi se deja en
          blanco, la app le pone una provisional para que pueda entrar al kiosco,
          igual que hace la importacion del Excel. */}
      {!form.documento.trim() && (
        <p style={{ fontSize: 12, color: 'var(--texto-suave)', margin: '4px 0 0' }}>
          Si lo dejas vacío se le asigna una cédula provisional (empieza por 1234)
          para que pueda entrar al kiosco. La app avisará hasta que escribas la real.
        </p>
      )}
      <input placeholder="Nombre *" value={form.nombre} onChange={e => cambiar('nombre', e.target.value)} style={{ width: '100%', marginTop: 8 }} />
      <input placeholder="Teléfono" value={form.telefono} onChange={e => cambiar('telefono', e.target.value)} style={{ width: '100%', marginTop: 8 }} />
      <input placeholder="Email" value={form.email} onChange={e => cambiar('email', e.target.value)} style={{ width: '100%', marginTop: 8 }} />
      <label style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        Fecha de nacimiento
        <input type="date" value={form.f_nacimiento} onChange={e => cambiar('f_nacimiento', e.target.value)} style={{ width: '100%' }} />
      </label>
      <input placeholder="Contacto de emergencia" value={form.contacto_emg} onChange={e => cambiar('contacto_emg', e.target.value)} style={{ width: '100%', marginTop: 8 }} />

      {/* 5.11: el textarea de Notas se cambia por la foto del cliente. */}
      <SelectorImagen
        entidad="cliente"
        entidadId={clienteExistente ? clienteExistente.id : null}
        nombre={form.nombre}
        etiqueta="Foto del cliente"
        onCambio={(b64) => { if (!clienteExistente) setFotoPendiente(b64); }}
      />

      {clienteExistente && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--borde-suave)' }}>
          <label style={{ display: 'block', marginBottom: 6 }}>Huella</label>
          {huellas === null ? (
            <p style={{ color: 'var(--texto-tenue)', margin: 0 }}>Consultando...</p>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--texto-suave)', margin: '0 0 8px' }}>
                {tieneHuella
                  ? 'Este cliente ya tiene una huella registrada.'
                  : 'Este cliente todavía no tiene huella.'}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={enrolarHuella} disabled={enrolando}>
                  {enrolando ? 'Coloca el dedo en el lector...' : tieneHuella ? 'Sustituir huella' : 'Registrar huella'}
                </button>
                {tieneHuella && (
                  <button onClick={eliminarHuella} disabled={enrolando}>Eliminar huella</button>
                )}
              </div>
              {mensajeHuella && (
                <p style={{ fontSize: 12, color: 'var(--texto-suave)', marginBottom: 0 }}>{mensajeHuella}</p>
              )}
            </>
          )}
        </div>
      )}

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      {/* 5.11: Guardar y Cancelar en la misma linea. El PIN va al lado, porque es
          una accion aparte: no se guarda con el resto del formulario. */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={guardar} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
        <button onClick={onCancelar} disabled={guardando}>Cancelar</button>
        {clienteExistente && (
          <button onClick={() => { setPanelPin(p => !p); setMensajePin(''); setPin(''); setPin2(''); }}>
            {tienePin ? '🔑 Cambiar PIN' : '🔑 Asignar PIN'}
          </button>
        )}
      </div>

      {clienteExistente && panelPin && (
        <div style={{ marginTop: 10, padding: 12, background: 'var(--superficie-alta)', borderRadius: 'var(--radio)' }}>
          <p style={{ fontSize: 12, color: 'var(--texto-suave)', marginTop: 0 }}>
            El cliente entra al kiosco con los <b>últimos 4 dígitos de su documento</b> y este PIN.
            {tienePin ? ' Ya tiene uno; si escribes otro, lo sustituye.' : ' Todavía no tiene ninguno.'}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="password" inputMode="numeric" maxLength={4} placeholder="PIN (4 dígitos)"
                   value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setMensajePin(''); }}
                   style={{ width: 130 }} />
            <input type="password" inputMode="numeric" maxLength={4} placeholder="Repítelo"
                   value={pin2} onChange={e => { setPin2(e.target.value.replace(/\D/g, '')); setMensajePin(''); }}
                   style={{ width: 130 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={guardarPin} disabled={guardandoPin}>
              {guardandoPin ? 'Guardando...' : 'Guardar PIN'}
            </button>
            {tienePin && (
              <button onClick={quitarPin} disabled={guardandoPin}>Eliminar PIN</button>
            )}
            <button onClick={() => { setPanelPin(false); setPin(''); setPin2(''); setMensajePin(''); }}
                    disabled={guardandoPin}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {mensajePin && (
        <p style={{ fontSize: 12, color: 'var(--texto-suave)', marginBottom: 0 }}>{mensajePin}</p>
      )}
    </div>
  );
}
