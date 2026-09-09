import { useState, useEffect, useRef } from 'react';

// Unica puerta de entrada. Antes habia dos pantallas seguidas: la passphrase de
// cifrado y luego el login. La passphrase ya no se pide al arrancar -- la
// contrasena del usuario abre el cifrado -- asi que solo queda esta.
//
// Quedan dos caminos aparte, los dos con passphrase:
//   - El enganche: la primera vez que un usuario entra despues del cambio aun no
//     tiene su llave, y hace falta la passphrase una unica vez para crearsela.
//   - Ctrl+Alt+D: acceso de desarrollador.
export default function Login({ onLogin }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);

  const [pidiendoEnganche, setPidiendoEnganche] = useState(false);
  const [passphrase, setPassphrase] = useState('');

  const [modoDev, setModoDev] = useState(false);
  const [passDev, setPassDev] = useState('');
  const passDevRef = useRef(null);

  // Atajo Ctrl+Alt+D para modo desarrollador.
  //
  // Se mira e.code ademas de e.key porque en Windows Ctrl+Alt es AltGr, y con un
  // teclado latinoamericano AltGr+D puede no producir la letra "d" en e.key.
  // e.code nombra la tecla fisica, asi que no depende de la distribucion.
  useEffect(() => {
    function atajo(e) {
      if (e.ctrlKey && e.altKey && (e.code === 'KeyD' || e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        setModoDev(m => !m);
        setError('');
      }
    }
    window.addEventListener('keydown', atajo);
    return () => window.removeEventListener('keydown', atajo);
  }, []);

  useEffect(() => {
    if (modoDev) passDevRef.current?.focus();
  }, [modoDev]);

  async function entrar() {
    if (entrando) return;
    setError('');
    setEntrando(true);
    const res = await window.api.auth.login(usuario, password);
    setEntrando(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.necesitaPassphrase) {
      setPidiendoEnganche(true);
      return;
    }
    onLogin(res.usuario);
  }

  async function enganchar() {
    if (entrando || !passphrase) return;
    setError('');
    setEntrando(true);
    const r = await window.api.auth.vincularPassphrase({ usuario, password, passphrase });
    setEntrando(false);

    if (!r.ok) {
      setError(r.motivo === 'passphrase_incorrecta'
        ? 'Esa no es la passphrase de cifrado.'
        : 'No se pudo abrir la base: ' + r.motivo);
      return;
    }
    setPassphrase('');
    setPidiendoEnganche(false);
    onLogin(r.usuario);
  }

  async function entrarComoDev() {
    if (entrando || !passDev) return;
    setError('');
    setEntrando(true);
    const r = await window.api.auth.accesoDesarrollador(passDev);
    setEntrando(false);

    if (!r.ok) {
      setError('Passphrase incorrecta.');
      return;
    }
    setPassDev('');
    onLogin(r.usuario);
  }

  const tecla = (fn) => (e) => { if (e.key === 'Enter') fn(); };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 360, padding: 32,
        background: 'var(--superficie)', border: '1px solid var(--borde-suave)',
        borderRadius: 'var(--radio)', boxShadow: 'var(--sombra)',
      }}>
        <h1 style={{ fontSize: 38, fontWeight: 800, letterSpacing: 0.5, color: 'var(--acento-claro)', margin: '0 0 20px' }}>
          GymApp
        </h1>

        {pidiendoEnganche ? (
          <>
            <p style={{ color: 'var(--texto-suave)', marginTop: 0 }}>
              Es la primera vez que entras desde el cambio. Escribe la passphrase
              de cifrado <b>una sola vez</b>: a partir de ahora entras solo con tu
              contraseña.
            </p>
            <input type="password" placeholder="Passphrase de cifrado" autoFocus
                   value={passphrase}
                   onChange={e => { setPassphrase(e.target.value); setError(''); }}
                   onKeyDown={tecla(enganchar)}
                   style={{ width: '100%', fontSize: 15, padding: 10 }} />
            <button onClick={enganchar} disabled={entrando}
                    style={{ width: '100%', marginTop: 14, padding: 11, fontWeight: 600 }}>
              {entrando ? 'Abriendo...' : 'Continuar'}
            </button>
            <button onClick={() => { setPidiendoEnganche(false); setPassphrase(''); setError(''); }}
                    disabled={entrando} style={{ width: '100%', marginTop: 8 }}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            <input placeholder="Usuario" value={usuario} autoFocus
                   onChange={e => { setUsuario(e.target.value); setError(''); }}
                   onKeyDown={tecla(entrar)}
                   style={{ width: '100%', fontSize: 15, padding: 10 }} />
            <input type="password" placeholder="Contraseña" value={password}
                   onChange={e => { setPassword(e.target.value); setError(''); }}
                   onKeyDown={tecla(entrar)}
                   style={{ width: '100%', fontSize: 15, padding: 10, marginTop: 10 }} />
            <button onClick={entrar} disabled={entrando}
                    style={{ width: '100%', marginTop: 14, padding: 11, fontWeight: 600 }}>
              {entrando ? 'Entrando...' : 'Entrar'}
            </button>
          </>
        )}

        {modoDev && !pidiendoEnganche && (
          <div style={{ marginTop: 20, padding: 14, border: '1px solid var(--borde)', borderRadius: 'var(--radio)', background: 'var(--superficie-alta)' }}>
            <p style={{ fontSize: 13, color: 'var(--texto-suave)', marginTop: 0, marginBottom: 8 }}>
              🔧 Acceso desarrollador — confirma con la passphrase
            </p>
            <input ref={passDevRef} type="password" placeholder="Passphrase" value={passDev}
                   onChange={e => { setPassDev(e.target.value); setError(''); }}
                   onKeyDown={tecla(entrarComoDev)}
                   style={{ width: '100%' }} />
            <button onClick={entrarComoDev} disabled={entrando} style={{ marginTop: 8, width: '100%' }}>
              {entrando ? 'Verificando...' : 'Entrar como desarrollador'}
            </button>
          </div>
        )}

        {error && <p style={{ color: 'var(--error)', marginBottom: 0 }}>{error}</p>}
      </div>

      {/* Marca provisional del gimnasio. Cuando exista el logo real se sustituye
          esta caja por la imagen; el hueco ya queda reservado y centrado. */}
      <div style={{
        marginTop: 28, width: 76, height: 76, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32, background: 'var(--superficie)',
        border: '1px solid var(--borde-suave)',
      }}>
        🏋️
      </div>
    </div>
  );
}
