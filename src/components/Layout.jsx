const OPCIONES = [
  { id: 'kiosco', label: 'Kiosco', roles: ['admin', 'asistente'] },
  { id: 'clientes', label: 'Clientes', roles: ['admin', 'asistente'] },
  { id: 'pos', label: 'POS', roles: ['admin', 'asistente'] },
  { id: 'caja', label: 'Caja', roles: ['admin', 'asistente'] },
  { id: 'planes', label: 'Planes', roles: ['admin'] },
  { id: 'inventario', label: 'Inventario', roles: ['admin'] },
  { id: 'dashboards', label: 'Dashboards', roles: ['admin'] },
  { id: 'usuarios', label: 'Usuarios', roles: ['admin'] },
  { id: 'configuracion', label: 'Configuración', roles: ['admin'] },
];

export default function Layout({ usuarioActual, pantallaActiva, onSeleccionar, onCerrarSesion, children }) {
  const opcionesVisibles = OPCIONES.filter(o => o.roles.includes(usuarioActual.rol));

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <nav style={{ width: 200, background: 'var(--nav-fondo)', color: 'var(--texto)', padding: 20 }}>
        <p><b>{usuarioActual.nombre}</b><br /><small>{usuarioActual.rol}</small></p>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {opcionesVisibles.map(o => (
            <li
              key={o.id}
              onClick={() => onSeleccionar(o.id)}
              style={{
                padding: '8px 0',
                cursor: 'pointer',
                fontWeight: pantallaActiva === o.id ? 'bold' : 'normal',
                color: pantallaActiva === o.id ? 'var(--acento-claro)' : 'var(--texto-suave)',
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
        <button onClick={onCerrarSesion}>Cerrar sesión</button>
      </nav>
      <main style={{ flex: 1, padding: 40, overflow: 'auto' }}>{children}</main>
    </div>
  );
}