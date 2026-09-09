// Firma del desarrollador, abajo a la derecha y en todas las pantallas.
//
// Va fija a la ventana y no dentro del contenido para que no se mueva al hacer
// scroll ni cambie de sitio segun la pantalla: es una firma, y una firma esta
// siempre en el mismo rincon.
//
// No captura el raton (pointer-events: none). En un mostrador, un adorno en una
// esquina que se coma el clic de un boton es un fallo que aparece justo el dia
// que hay cola, asi que aqui la esquina sigue siendo del boton que este debajo.
const CORREO = '2002.ha.mc@gmail.com';

export default function CreditoDesarrollador() {
  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 12,
      zIndex: 5, pointerEvents: 'none',
      textAlign: 'right', lineHeight: 1.35,
      fontSize: 11, color: 'var(--texto-tenue)',
      // La sombra es para que se lea igual cuando el video de fondo pasa por un
      // fotograma claro justo detras de ella.
      textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)',
    }}>
      <div>App desarrollada by <b style={{ color: 'var(--texto-suave)' }}>H.A.M.C Solutions</b></div>
      <div>Contact: {CORREO}</div>
    </div>
  );
}
