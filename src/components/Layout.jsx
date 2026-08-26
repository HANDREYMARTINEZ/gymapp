const OPCIONES = [
  { label: 'Kiosco', roles: ['admin', 'asistente'] },
  { label: 'Clientes', roles: ['admin', 'asistente'] },
  { label: 'POS', roles: ['admin', 'asistente'] },
  { label: 'Caja', roles: ['admin', 'asistente'] },
  { label: 'Planes', roles: ['admin'] },
  { label: 'Inventario', roles: ['admin'] },
  { label: 'Dashboards', roles: ['admin'] },
  { label: 'Usuarios', roles: ['admin'] },
  { label: 'Configuración', roles: ['admin'] },
];

export default function Layout({ usuarioActual, onCerrarSesion, children }) {
  const opcionesVisibles = OPCIONES.filter(o => o.roles.includes(usuarioActual.rol));

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <nav style={{ width: 200, background: '#1e1e1e', color: 'white', padding: 20 }}>
        <p><b>{usuarioActual.nombre}</b><br /><small>{usuarioActual.rol}</small></p>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {opcionesVisibles.map(o => <li key={o.label} style={{ padding: '8px 0' }}>{o.label}</li>)}
        </ul>
        <button onClick={onCerrarSesion}>Cerrar sesión</button>
      </nav>
      <main style={{ flex: 1, padding: 40 }}>{children}</main>
    </div>
  );
}