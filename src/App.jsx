import { useState, useEffect } from 'react';
import PasoBienvenida from './screens/Setup/PasoBienvenida';
import PasoDatosGimnasio from './screens/Setup/PasoDatosGimnasio';
import PasoAdmin from './screens/Setup/PasoAdmin';
import PasoPassphrase from './screens/Setup/PasoPassphrase';
import Login from './screens/Login';
import PantallaCarga from './components/PantallaCarga';
import Layout from './components/Layout';
import Clientes from './screens/Clientes';
import Planes from './screens/Planes';
import Kiosco from './screens/Kiosco';
import Configuracion from './screens/Configuracion';
import Inventario from './screens/Inventario';
import Caja from './screens/Caja';
import POS from './screens/POS';
import Usuarios from './screens/Usuarios';
import Dashboards from './screens/Dashboards';
import Desarrollador from './screens/Desarrollador';
import { instalarLectorGlobal } from './lector/lector';


const CONSTRUIDAS = ['clientes', 'planes', 'kiosco', 'pos', 'inventario', 'caja', 'dashboards', 'usuarios', 'configuracion', 'desarrollador'];
const INICIAL = 'kiosco';
const TOPE_HISTORIAL = 50;

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [setupCompleto, setSetupCompleto] = useState(false);
  const [paso, setPaso] = useState(1);
  const [usuarioActual, setUsuarioActual] = useState(null);
  const [mostrandoIntro, setMostrandoIntro] = useState(false);

  // La navegacion es una pila, no una sola pantalla, porque el boton de volver
  // tiene que llevar a la pestana anterior de verdad y no alternar entre dos.
  // El tope de la pila es lo que se esta viendo.
  const [historial, setHistorial] = useState([INICIAL]);
  const pantallaActiva = historial[historial.length - 1];
  const pantallaAnterior = historial.length > 1 ? historial[historial.length - 2] : null;

  // La cortina de entrada se levanta aqui y no dentro del Login para que salga
  // por los tres caminos que dan acceso: contrasena, enganche de passphrase y
  // acceso de desarrollador. Los tres acaban llamando a esto.
  function iniciarSesion(usuario) {
    setUsuarioActual(usuario);
    setMostrandoIntro(true);
  }

  function navegar(id) {
    setHistorial(h => {
      if (h[h.length - 1] === id) return h;
      // El recepcionista deja la app abierta durante semanas. Sin tope, cada
      // clic en el menu deja una entrada mas en memoria para siempre.
      const siguiente = [...h, id];
      return siguiente.length > TOPE_HISTORIAL ? siguiente.slice(-TOPE_HISTORIAL) : siguiente;
    });
  }

  function volver() {
    setHistorial(h => (h.length > 1 ? h.slice(0, -1) : h));
  }

  function cerrarSesion() {
    // El proceso principal tiene su propio interruptor de sesion de
    // desarrollador, y es el que de verdad manda: si no se cierra aqui, las
    // herramientas de borrado seguirian respondiendo despues del relevo.
    window.api.auth.cerrarSesion();
    setUsuarioActual(null);
    setMostrandoIntro(false);
    // Sin esto el siguiente turno hereda el recorrido del anterior y su boton
    // de volver lleva a donde estuvo otra persona.
    setHistorial([INICIAL]);
  }

  // El lector de codigos de barras se instala aqui, arriba del todo, y no en
  // Vender: es un teclado, y teclea en cualquier pantalla. Asi tambien el Login
  // y el kiosco quedan protegidos de un escaneo que meta digitos en la
  // contrasena o en el PIN. Ver src/lector/lector.js.
  useEffect(() => instalarLectorGlobal(), []);

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

  // Una sola puerta: el login. La passphrase de cifrado ya no se pide al
  // arrancar porque la contrasena del usuario abre la DEK; se reserva para el
  // acceso de desarrollador, que vive dentro de esta misma pantalla.
  if (!usuarioActual) {
    return <Login onLogin={iniciarSesion} />;
  }

  // La app se monta despues de la cortina, no debajo: el kiosco enciende el
  // lector de huella y se pone a escuchar el teclado en cuanto aparece, y no
  // conviene que haga nada mientras la pantalla esta tapada.
  if (mostrandoIntro) {
    return <PantallaCarga onTerminar={() => setMostrandoIntro(false)} />;
  }

  return (
    <Layout
      usuarioActual={usuarioActual}
      pantallaActiva={pantallaActiva}
      pantallaAnterior={pantallaAnterior}
      onSeleccionar={navegar}
      onVolver={volver}
      onCerrarSesion={cerrarSesion}
    >
      {pantallaActiva === 'clientes' && <Clientes usuarioActual={usuarioActual} />}
      {pantallaActiva === 'planes' && <Planes />}
      {pantallaActiva === 'kiosco' && <Kiosco />}
      {pantallaActiva === 'pos' && <POS usuarioActual={usuarioActual} />}
      {pantallaActiva === 'inventario' && <Inventario usuarioActual={usuarioActual} />}
      {pantallaActiva === 'caja' && <Caja usuarioActual={usuarioActual} />}
      {pantallaActiva === 'dashboards' && <Dashboards />}
      {pantallaActiva === 'usuarios' && <Usuarios usuarioActual={usuarioActual} />}
      {pantallaActiva === 'configuracion' && <Configuracion usuarioActual={usuarioActual} />}
      {pantallaActiva === 'desarrollador' && usuarioActual.desarrollador && <Desarrollador />}
      {!CONSTRUIDAS.includes(pantallaActiva) && <p>Pantalla "{pantallaActiva}" — pendiente de construir</p>}
    </Layout>
  );
}