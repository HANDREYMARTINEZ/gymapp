import { useEffect, useRef } from 'react';
import fondo from '../media/fondo.mp4';

// Fondo animado de toda la app. Vive detras de todo (z-index -1) y con un velo
// oscuro encima: el video es ambiente, no decoracion protagonista. Sin el velo
// las tablas y los formularios quedan ilegibles cuando el video pasa por un
// fotograma claro, que es justo lo que significa "que no rompa la app".
//
// El video no lleva controles ni recibe clics (pointer-events: none), asi que
// no hay forma de tropezar con el mientras se atiende el mostrador.
export default function FondoVideo() {
  const ref = useRef(null);

  // La recepcion deja la app abierta semanas enteras. Si la ventana esta
  // minimizada u oculta no hay nadie mirando el fondo, y seguir decodificando
  // video es gastar CPU para nada.
  useEffect(() => {
    function alCambiarVisibilidad() {
      const v = ref.current;
      if (!v) return;
      if (document.hidden) v.pause();
      else v.play().catch(() => {});
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => document.removeEventListener('visibilitychange', alCambiarVisibilidad);
  }, []);

  return (
    <div className="fondo-video" aria-hidden="true">
      <video ref={ref} src={fondo} autoPlay loop muted playsInline preload="auto" />
      <div className="fondo-video-velo" />
    </div>
  );
}
