import './estilos.css';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import FondoVideo from './components/FondoVideo.jsx';
import CreditoDesarrollador from './components/CreditoDesarrollador.jsx';
import PantallaKiosco from './components/PantallaKiosco.jsx';

// El fondo y la firma van fuera de <App> a proposito: App cambia de raiz entera
// segun el momento (asistente de instalacion, login, cortina, aplicacion), y los
// dos tienen que sobrevivir a esos cambios -- el fondo sin reiniciar el video, y
// la firma sin tener que repetirla en cada pantalla.
//
// La ventana del monitor de los clientes carga este mismo bundle con
// #segunda-pantalla y solo pinta el kiosco. Ver components/PantallaKiosco.jsx.
const esSegundaPantalla = window.location.hash === '#segunda-pantalla';

createRoot(document.getElementById('root')).render(
  esSegundaPantalla ? (
    <>
      <FondoVideo />
      <PantallaKiosco />
    </>
  ) : (
    <>
      <FondoVideo />
      <App />
      <CreditoDesarrollador />
    </>
  )
);