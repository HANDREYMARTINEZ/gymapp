import { useState } from 'react';
import BotonVolver from './BotonVolver';

// Las secciones van agrupadas por lo que se hace con ellas, no en una lista
// corrida: lo del mostrador todo el dia arriba, lo de administrar en medio, y lo
// que casi nunca se toca al final. El emoji es para reconocer la seccion de un
// vistazo sin leer, que es como se usa un menu que ya te sabes de memoria.
const GRUPOS = [
  {
    titulo: 'Día a día',
    opciones: [
      { id: 'kiosco', label: 'Kiosco', emoji: '🚪', roles: ['admin', 'asistente'] },
      { id: 'clientes', label: 'Clientes', emoji: '👥', roles: ['admin', 'asistente'] },
      { id: 'pos', label: 'Vender', emoji: '🛒', roles: ['admin', 'asistente'] },
      { id: 'caja', label: 'Caja', emoji: '💵', roles: ['admin', 'asistente'] },
    ],
  },
  {
    titulo: 'Administrar',
    opciones: [
      { id: 'planes', label: 'Planes', emoji: '📋', roles: ['admin'] },
      { id: 'inventario', label: 'Inventario', emoji: '📦', roles: ['admin'] },
      { id: 'dashboards', label: 'Dashboards', emoji: '📊', roles: ['admin'] },
    ],
  },
  {
    titulo: 'Sistema',
    opciones: [
      { id: 'usuarios', label: 'Usuarios', emoji: '👤', roles: ['admin'] },
      { id: 'configuracion', label: 'Configuración', emoji: '⚙️', roles: ['admin'] },
    ],
  },
  // Este grupo no se filtra por rol sino por como se entro: el desarrollador
  // tiene rol admin, asi que por rol lo veria tambien el admin del gimnasio.
  // Lo que lo separa es haber escrito la passphrase en Ctrl+Alt+D.
  {
    titulo: 'Desarrollador',
    soloDev: true,
    opciones: [
      { id: 'desarrollador', label: 'Herramientas', emoji: '🔧', roles: ['admin', 'asistente'] },
    ],
  },
];

const TODAS = GRUPOS.flatMap(g => g.opciones);

const ANCHO_ABIERTO = 232;
const ANCHO_CERRADO = 68;

export default function Layout({ usuarioActual, pantallaActiva, pantallaAnterior, onSeleccionar, onVolver, onCerrarSesion, children }) {
  const [abierto, setAbierto] = useState(true);

  const grupos = GRUPOS
    .filter(g => !g.soloDev || usuarioActual.desarrollador)
    .map(g => ({ ...g, opciones: g.opciones.filter(o => o.roles.includes(usuarioActual.rol)) }))
    .filter(g => g.opciones.length > 0);

  // El boton de volver vive aqui y no repetido en las nueve pantallas: el
  // encabezado de todas ellas es este <main>, y asi ninguna puede quedarse sin
  // el. Lleva el nombre del destino porque la ficha de cliente tiene su propio
  // "volver a la lista", y dos botones iguales que hacen cosas distintas
  // confunden.
  const anterior = TODAS.find(o => o.id === pantallaAnterior);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <nav style={{
        width: abierto ? ANCHO_ABIERTO : ANCHO_CERRADO,
        flexShrink: 0,
        background: 'var(--nav-fondo)',
        borderRight: '1px solid var(--borde-suave)',
        color: 'var(--texto)',
        padding: '14px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        overflowY: 'auto',
        transition: 'width 0.15s',
      }}>
        <button
          onClick={() => setAbierto(a => !a)}
          title={abierto ? 'Contraer el menú' : 'Desplegar el menú'}
          aria-label={abierto ? 'Contraer el menú' : 'Desplegar el menú'}
          style={{
            background: 'none', border: 'none', color: 'var(--texto-suave)',
            fontSize: 22, lineHeight: 1, padding: '6px 10px', alignSelf: 'flex-start',
            cursor: 'pointer',
          }}
        >
          ☰
        </button>

        {/* 5.6: la cabecera decia el nombre y debajo el rol, que con un usuario
            llamado "Admin" se leia "Admin / admin" y no explicaba nada. Ahora
            lleva una etiqueta fija que dice que es esto, y el rol como distintivo. */}
        {abierto && (
          <div style={{
            padding: '10px 12px', marginBottom: 6,
            background: 'var(--superficie)', border: '1px solid var(--borde-suave)',
            borderRadius: 'var(--radio)',
          }}>
            <div style={{
              fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase',
              color: 'var(--texto-tenue)', marginBottom: 2,
            }}>
              Sesión
            </div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{usuarioActual.nombre}</div>
            <div style={{
              display: 'inline-block', marginTop: 6, padding: '1px 8px',
              fontSize: 11, borderRadius: 999,
              background: 'var(--acento-oscuro)', color: 'var(--sobre-acento)',
            }}>
              {usuarioActual.rol}
            </div>
          </div>
        )}

        {grupos.map((g, i) => (
          <div key={g.titulo}>
            {abierto ? (
              <div style={{
                fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase',
                color: 'var(--texto-tenue)', padding: '10px 12px 4px',
              }}>
                {g.titulo}
              </div>
            ) : (
              i > 0 && <hr style={{ border: 0, borderTop: '1px solid var(--borde-suave)', margin: '8px 4px' }} />
            )}

            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {g.opciones.map(o => {
                const activa = pantallaActiva === o.id;
                return (
                  <li
                    key={o.id}
                    onClick={() => onSeleccionar(o.id)}
                    title={o.label}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: abierto ? '10px 12px' : '10px 0',
                      justifyContent: abierto ? 'flex-start' : 'center',
                      cursor: 'pointer',
                      borderRadius: 'var(--radio)',
                      border: '1px solid ' + (activa ? 'var(--acento)' : 'transparent'),
                      background: activa ? 'var(--superficie-alta)' : 'transparent',
                      fontWeight: activa ? 700 : 400,
                      fontSize: 15,
                      color: activa ? 'var(--acento-claro)' : 'var(--texto-suave)',
                    }}
                  >
                    <span style={{ fontSize: 17, lineHeight: 1 }}>{o.emoji}</span>
                    {abierto && <span>{o.label}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div style={{ flex: 1 }} />
        <button
          onClick={onCerrarSesion}
          title="Cerrar sesión"
          style={{ width: '100%', padding: abierto ? '8px 12px' : '8px 0' }}
        >
          {abierto ? 'Cerrar sesión' : '⏻'}
        </button>
      </nav>

      <main style={{ flex: 1, padding: 40, overflow: 'auto' }}>
        {anterior && <BotonVolver onClick={onVolver} texto={'← Volver a ' + anterior.label} />}
        {children}
      </main>
    </div>
  );
}
