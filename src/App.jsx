import { useState, useEffect } from 'react';
import PasoBienvenida from './screens/Setup/PasoBienvenida';
import PasoDatosGimnasio from './screens/Setup/PasoDatosGimnasio';
import PasoAdmin from './screens/Setup/PasoAdmin';
import PasoPassphrase from './screens/Setup/PasoPassphrase';
import Login from './screens/Login';
import Layout from './components/Layout';
import Clientes from './screens/Clientes';
import Planes from './screens/Planes';
import Kiosco from './screens/Kiosco';
import Desbloqueo from './screens/Desbloqueo';
import Configuracion from './screens/Configuracion';


const CONSTRUIDAS = ['clientes', 'planes', 'kiosco', 'configuracion'];

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [setupCompleto, setSetupCompleto] = useState(false);
  const [paso, setPaso] = useState(1);
  const [usuarioActual, setUsuarioActual] = useState(null);
  const [pantallaActiva, setPantallaActiva] = useState('kiosco');
  const [desbloqueado, setDesbloqueado] = useState(false);

  useEffect(() => {
    window.api.setup.estado().then(estado => {
      setSetupCompleto(estado.setupCompleto);
      setCargando(false);
    });
  }, []);

  if (cargando) return <p style={{ padding: 40 }}>Cargando...</p>;

  if (!setupCompleto) {
    return (
      <div style={{ padding: 40 }}>
        {paso === 1 && <PasoBienvenida onSiguiente={() => setPaso(2)} />}
        {paso === 2 && <PasoDatosGimnasio onSiguiente={() => setPaso(3)} />}
        {paso === 3 && <PasoAdmin onSiguiente={() => setPaso(4)} />}
        {paso === 4 && <PasoPassphrase onFinalizar={() => setSetupCompleto(true)} />}
      </div>
    );
  }

   // AGREGA este bloque nuevo aquí, después del bloque de setup:
  if (!desbloqueado) {
    return <Desbloqueo onDesbloqueado={() => setDesbloqueado(true)} />;
  }

  if (!usuarioActual) {
    return <Login onLogin={setUsuarioActual} />;
  }

  return (
    <Layout
      usuarioActual={usuarioActual}
      pantallaActiva={pantallaActiva}
      onSeleccionar={setPantallaActiva}
      onCerrarSesion={() => setUsuarioActual(null)}
    >
      {pantallaActiva === 'clientes' && <Clientes usuarioActual={usuarioActual} />}
      {pantallaActiva === 'planes' && <Planes />}
      {pantallaActiva === 'kiosco' && <Kiosco />}
      {pantallaActiva === 'configuracion' && <Configuracion />}
      {!CONSTRUIDAS.includes(pantallaActiva) && <p>Pantalla "{pantallaActiva}" — pendiente de construir</p>}
    </Layout>
  );
}