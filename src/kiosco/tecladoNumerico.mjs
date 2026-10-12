// Que hace cada tecla del teclado numerico en el kiosco de la segunda pantalla
// (pedido el 12-oct-2026).
//
// En el monitor de los clientes hay un teclado numerico para quien no marca con
// la huella. Esa ventana se abre sin quitarle el foco a recepcion, asi que las
// teclas iban a donde estuviera escribiendo recepcion -- y para marcar habia
// que llevar el raton al otro monitor y hacer clic, cosa que nadie hace si la
// recepcion esta sola. Ahora las teclas del bloque numerico las atrapa la app
// (electron/services/tecladoKiosco.js) y llegan aqui, tenga el foco quien lo
// tenga. Aqui solo se decide que hacen.
//
// Sin raton ni foco no hay "cambiar de casilla", asi que va todo seguido: los
// cuatro primeros digitos son el documento, los cuatro siguientes el PIN, y al
// completar el octavo se marca solo. Cualquier otra tecla del bloque (. - + * /)
// borra el ultimo digito, y Enter marca si ya estan los ocho.

export const BORRAR = 'borrar';
export const ENTER = 'enter';

// estado: { ult4, pin, hayResultado, enviando }
// Devuelve { ult4, pin, limpiarResultado, marcar } o null si la tecla no hace
// nada ahora mismo.
export function aplicarTecla(estado, tecla) {
  // Mientras se verifica no se toca nada: lo que se esta comprobando es lo que
  // se ve.
  if (estado.enviando) return null;

  let { ult4, pin } = estado;
  let limpiarResultado = false;

  // Con el mensaje del anterior todavia en pantalla, el siguiente no tiene que
  // esperar a que se borre solo: su primer digito empieza de cero.
  if (estado.hayResultado) {
    if (!/^[0-9]$/.test(tecla)) return null;
    return { ult4: tecla, pin: '', limpiarResultado: true, marcar: false };
  }

  if (/^[0-9]$/.test(tecla)) {
    if (ult4.length < 4) ult4 += tecla;
    else if (pin.length < 4) pin += tecla;
    else return null;
    return { ult4, pin, limpiarResultado, marcar: ult4.length === 4 && pin.length === 4 };
  }

  if (tecla === BORRAR) {
    if (pin.length > 0) pin = pin.slice(0, -1);
    else if (ult4.length > 0) ult4 = ult4.slice(0, -1);
    else return null;
    return { ult4, pin, limpiarResultado, marcar: false };
  }

  if (tecla === ENTER) {
    return { ult4, pin, limpiarResultado, marcar: true };
  }

  return null;
}
