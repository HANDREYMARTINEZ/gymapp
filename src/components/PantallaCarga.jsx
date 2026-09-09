import { useEffect, useRef, useState } from 'react';
import intro from '../media/pantalla-carga.mp4';

// Cortina entre el login y la app, al estilo de la que sale al abrir Netflix:
// se acierta la contrasena, entra la animacion de la marca, y al terminar
// aparece la aplicacion.
//
// Regla que manda sobre todo lo demas: esto NUNCA puede dejar a nadie
// encerrado. Si el video no carga, no arranca o el archivo falta, la cortina se
// levanta igual. Por eso hay tres salidas -- fin del video, error, y un tope de
// tiempo -- y ademas se puede saltar con un clic o una tecla, porque en un
// mostrador con cola no se esperan cinco segundos.
const TOPE_MS = 8000;   // red de seguridad: mas que la duracion real del video
const FUNDIDO_MS = 320; // el fundido a negro con el que se entrega la app

export default function PantallaCarga({ onTerminar }) {
  const [saliendo, setSaliendo] = useState(false);
  const videoRef = useRef(null);
  const yaTermino = useRef(false);

  useEffect(() => {
    // Las tres salidas y el salto manual acaban aqui, y cualquiera puede llegar
    // primero: sin este cerrojo, onTerminar se llamaria dos veces.
    function terminar() {
      if (yaTermino.current) return;
      yaTermino.current = true;
      setSaliendo(true);
      setTimeout(onTerminar, FUNDIDO_MS);
    }

    const tope = setTimeout(terminar, TOPE_MS);

    const video = videoRef.current;
    if (video) {
      video.addEventListener('ended', terminar);
      video.addEventListener('error', terminar);

      // Muda a proposito: esto suena cada vez que alguien entra, y en un
      // mostrador con gente eso cansa al tercer turno. Ademas, sin sonido
      // ninguna politica de autoreproduccion la puede bloquear.
      video.play().catch(terminar);
    }

    function saltar() { terminar(); }
    window.addEventListener('keydown', saltar);
    window.addEventListener('mousedown', saltar);

    return () => {
      clearTimeout(tope);
      window.removeEventListener('keydown', saltar);
      window.removeEventListener('mousedown', saltar);
      if (video) {
        video.removeEventListener('ended', terminar);
        video.removeEventListener('error', terminar);
      }
    };
  }, [onTerminar]);

  return (
    <div
      className="pantalla-carga"
      style={{ opacity: saliendo ? 0 : 1, transition: 'opacity ' + FUNDIDO_MS + 'ms ease' }}
    >
      <video ref={videoRef} src={intro} muted playsInline preload="auto" />
      <span className="pantalla-carga-saltar">Pulsa cualquier tecla para saltar</span>
    </div>
  );
}
