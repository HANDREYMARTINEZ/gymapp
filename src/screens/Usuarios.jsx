import { useState, useEffect } from 'react';

const MOTIVOS = {
  nombre_requerido: 'El nombre es obligatorio.',
  rol_invalido: 'Elige un rol válido.',
  usuario_muy_corto: 'El usuario debe tener al menos 3 caracteres.',
  password_muy_corta: 'La contraseña debe tener al menos 4 caracteres.',
  usuario_ya_existe: 'Ese usuario ya está tomado.',
  ultimo_admin: 'Es el último administrador activo. Si lo dejas fuera, nadie podría volver a entrar a administrar la app. Nombra otro administrador primero.',
  ya_inactivo: 'Ya estaba inactivo.',
  no_existe: 'Ese usuario ya no existe.',
};

const traducir = (motivo) => MOTIVOS[motivo] || 'No se pudo completar: ' + motivo;

const ROL_ETIQUETA = { admin: 'Administrador', asistente: 'Asistente' };

function fecha(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function UsuarioForm({ usuarioExistente, onGuardado, onCancelar }) {
  const editando = !!usuarioExistente;
  const [form, setForm] = useState({
    nombre: usuarioExistente ? usuarioExistente.nombre : '',
    usuario: '', password: '', password2: '',
    rol: usuarioExistente ? usuarioExistente.rol : 'asistente',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  function cambiar(campo, valor) {
    setForm({ ...form, [campo]: valor });
    setError('');
  }

  async function guardar() {
    if (!form.nombre.trim()) { setError('El nombre es obligatorio.'); return; }

    if (!editando) {
      if (!form.usuario.trim()) { setError('El usuario es obligatorio.'); return; }
      if (form.password !== form.password2) { setError('Las contraseñas no coinciden.'); return; }
    }

    setGuardando(true);
    const r = editando
      ? await window.api.usuarios.editar(usuarioExistente.id, { nombre: form.nombre, rol: form.rol })
      : await window.api.usuarios.crear({
          nombre: form.nombre, usuario: form.usuario, password: form.password, rol: form.rol,
        });
    setGuardando(false);

    if (!r.ok) { setError(traducir(r.motivo)); return; }
    onGuardado();
  }

  return (
    <div style={{ border: '1px solid var(--borde)', padding: 20, marginTop: 16, maxWidth: 440 }}>
      <h3 style={{ marginTop: 0 }}>{editando ? 'Editar usuario' : 'Nuevo usuario'}</h3>

      <input placeholder="Nombre completo *" value={form.nombre}
             onChange={e => cambiar('nombre', e.target.value)} style={{ width: '100%' }} />

      {editando ? (
        <p style={{ color: 'var(--texto-suave)', fontSize: 13 }}>
          Usuario: <b>{usuarioExistente.usuario}</b> — no se puede cambiar, porque es
          lo que ata a esta persona con su historial.
        </p>
      ) : (
        <>
          <br /><input placeholder="Usuario para iniciar sesión *" value={form.usuario}
                       onChange={e => cambiar('usuario', e.target.value)}
                       style={{ marginTop: 6, width: '100%' }} />
          <small style={{ color: 'var(--texto-suave)' }}>No distingue mayúsculas de minúsculas.</small>
          <br /><input type="password" placeholder="Contraseña *" value={form.password}
                       onChange={e => cambiar('password', e.target.value)} style={{ marginTop: 6 }} />
          <br /><input type="password" placeholder="Confirmar contraseña *" value={form.password2}
                       onChange={e => cambiar('password2', e.target.value)} style={{ marginTop: 6 }} />
        </>
      )}

      <br /><select value={form.rol} onChange={e => cambiar('rol', e.target.value)} style={{ marginTop: 8 }}>
        <option value="asistente">Asistente — Kiosco, Clientes, POS y Caja</option>
        <option value="admin">Administrador — todo, incluidos Planes y Usuarios</option>
      </select>

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <br /><button onClick={guardar} disabled={guardando} style={{ marginTop: 8 }}>
        {guardando ? 'Guardando...' : 'Guardar'}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}

function CambiarPassword({ usuario, esUnoMismo, onListo, onCancelar }) {
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (password !== password2) { setError('Las contraseñas no coinciden.'); return; }
    setGuardando(true);
    const r = await window.api.usuarios.cambiarPassword({ id: usuario.id, password });
    setGuardando(false);
    if (!r.ok) { setError(traducir(r.motivo)); return; }
    onListo();
  }

  return (
    <div style={{ border: '1px solid var(--borde-fuerte)', padding: 16, marginTop: 16, maxWidth: 440 }}>
      <h3 style={{ marginTop: 0 }}>Cambiar contraseña — {usuario.nombre}</h3>
      {esUnoMismo && (
        <p style={{ color: 'var(--texto-suave)' }}>
          Es tu propia cuenta. Vas a seguir en sesión, pero la próxima vez que
          entres será con la nueva.
        </p>
      )}
      <input type="password" placeholder="Nueva contraseña" value={password}
             onChange={e => { setPassword(e.target.value); setError(''); }} />
      <br /><input type="password" placeholder="Confirmar" value={password2}
                   onChange={e => { setPassword2(e.target.value); setError(''); }}
                   style={{ marginTop: 6 }} />
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
      <br /><button onClick={guardar} disabled={guardando} style={{ marginTop: 8 }}>
        {guardando ? 'Guardando...' : 'Cambiar contraseña'}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}

export default function Usuarios({ usuarioActual }) {
  const [usuarios, setUsuarios] = useState([]);
  const [modo, setModo] = useState('lista');
  const [editando, setEditando] = useState(null);
  const [cambiandoPassword, setCambiandoPassword] = useState(null);
  const [aviso, setAviso] = useState(null);

  async function cargar() {
    setUsuarios(await window.api.usuarios.listar());
  }

  useEffect(() => { cargar(); }, []);

  function volver() {
    setModo('lista');
    setEditando(null);
    setCambiandoPassword(null);
    cargar();
  }

  async function alternarActivo(u) {
    setAviso(null);
    const r = u.activo
      ? await window.api.usuarios.desactivar(u.id)
      : await window.api.usuarios.activar(u.id);
    if (!r.ok) { setAviso({ tipo: 'error', texto: traducir(r.motivo) }); return; }
    cargar();
  }

  const adminsActivos = usuarios.filter(u => u.rol === 'admin' && u.activo).length;

  return (
    <div>
      <h1>Usuarios</h1>

      {adminsActivos === 1 && (
        <p style={{ color: 'var(--texto-suave)', maxWidth: 640 }}>
          Hay un solo administrador activo. Mientras siga siendo el único, no se
          podrá desactivar ni bajar a asistente: dejaría la app sin nadie que
          pueda administrarla.
        </p>
      )}

      {modo === 'lista' && !cambiandoPassword && (
        <button onClick={() => setModo('nuevo')}>+ Nuevo usuario</button>
      )}

      {aviso && (
        <p style={{ color: aviso.tipo === 'error' ? 'var(--error)' : 'var(--exito)', maxWidth: 640 }}>
          {aviso.texto}
        </p>
      )}

      {(modo === 'nuevo' || modo === 'editar') && (
        <UsuarioForm
          usuarioExistente={modo === 'editar' ? editando : null}
          onGuardado={volver}
          onCancelar={volver}
        />
      )}

      {cambiandoPassword && (
        <CambiarPassword
          usuario={cambiandoPassword}
          esUnoMismo={cambiandoPassword.id === usuarioActual.id}
          onListo={() => { setAviso({ tipo: 'ok', texto: 'Contraseña actualizada.' }); volver(); }}
          onCancelar={() => setCambiandoPassword(null)}
        />
      )}

      <table style={{ marginTop: 20, borderCollapse: 'collapse', width: '100%', maxWidth: 860 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--borde-fuerte)' }}>
            <th>Nombre</th><th>Usuario</th><th>Rol</th><th>Desde</th><th>Estado</th><th></th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map(u => (
            <tr key={u.id} style={{ borderBottom: '1px solid var(--borde-suave)', opacity: u.activo ? 1 : 0.5 }}>
              <td>
                {u.nombre}{u.id === usuarioActual.id && <small style={{ color: 'var(--texto-tenue)' }}> (tú)</small>}
                {/* Sin llave propia, a este usuario la app le pedirá la
                    passphrase de cifrado la primera vez que entre — y esa misma
                    passphrase abre el panel de desarrollador. Ponerle la
                    contraseña desde aquí se la crea. */}
                {u.activo === 1 && u.tieneLlave === false && (
                  <div style={{ fontSize: 12, color: 'var(--aviso)', maxWidth: 260 }}>
                    {'⚠'} Todavía no puede entrar solo con su contraseña: pulsa
                    «Contraseña» y ponle una. Si no, la app le pedirá la passphrase
                    de cifrado, que no debería salir de ti.
                  </div>
                )}
              </td>
              <td>{u.usuario}</td>
              <td>{ROL_ETIQUETA[u.rol] || u.rol}</td>
              <td>{fecha(u.creado_en)}</td>
              <td>{u.activo ? 'Activo' : 'Inactivo'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button onClick={() => { setEditando(u); setModo('editar'); setCambiandoPassword(null); setAviso(null); }}>
                  Editar
                </button>
                <button onClick={() => { setCambiandoPassword(u); setModo('lista'); setAviso(null); }} style={{ marginLeft: 4 }}>
                  Contraseña
                </button>
                <button onClick={() => alternarActivo(u)} style={{ marginLeft: 4 }}>
                  {u.activo ? 'Desactivar' : 'Activar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
