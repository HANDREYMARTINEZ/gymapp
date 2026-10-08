import { useEffect, useState } from 'react';
import Kiosco from '../screens/Kiosco';
import { instalarLectorGlobal } from '../lector/lector';

// Lo unico que se ve en el monitor de los clientes: el kiosco, a pantalla
// completa y mas grande, sin menu ni sesion. La abre recepcion desde la ventana
// principal (boton "Segunda pantalla" o F2) y la ventana la crea
// electron/ipc/pantallaKiosco.js.
//
// No pasa por el login: solo se puede abrir desde dentro de una sesion, y si
// recepcion cierra sesion para cambiar de turno, los clientes tienen que seguir
// pudiendo entrar.

// El kiosco esta pensado para 460 px de ancho al lado de un menu. En un monitor
// entero a un par de metros se queda pequeno, asi que se agranda con la altura
// de la pantalla, sin pasarse para que el mensaje con la foto siga cabiendo.
function escalaPara(alto) {
  return Math.min(1.7, Math.max(1, alto / 820));
}

export default function PantallaKiosco() {
  const [escala, setEscala] = useState(() => escalaPara(window.innerHeight));

  // El lector de codigos teclea donde este el foco. Si alguien hizo clic en esta
  // ventana, un escaneo no puede acabar como digitos del PIN.
  useEffect(() => instalarLectorGlobal(), []);

  useEffect(() => {
    const alCambiar = () => setEscala(escalaPara(window.innerHeight));
    window.addEventListener('resize', alCambiar);
    return () => window.removeEventListener('resize', alCambiar);
  }, []);

  // F2 tambien la cierra desde aqui: si el foco quedo en esta ventana, el atajo
  // de la principal no llega.
  useEffect(() => {
    const atajo = (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        window.api.pantallaKiosco.cerrar();
      }
    };
    window.addEventListener('keydown', atajo);
    return () => window.removeEventListener('keydown', atajo);
  }, []);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ zoom: escala, width: '100%', paddingBottom: 48 }}>
        <Kiosco />
      </div>
    </div>
  );
}
