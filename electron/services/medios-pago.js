// Un solo vocabulario de medios de pago para membresias y para el POS. Estaba
// escrito a mano en el <select> de RegistrarPagoForm; si el POS lo hubiera
// copiado, cualquier retoque en uno habria dejado al otro desalineado en
// silencio, y la comparacion con 'Efectivo' es justamente la que decide si el
// dinero entra al arqueo de caja.

// 'QR' y 'Llave' salen del control del gimnasio: son 17 de los 27 cobros de la
// hoja real. 'Llave' es una transferencia que cae en la cuenta de Bancolombia,
// pero en el mostrador se dice asi y asi se guarda: renombrarla a
// 'Transferencia' obligaria a traducir mentalmente cada arqueo.
//
// Ninguno de los dos es efectivo, asi que ninguno entra al cajon: eso lo
// decide esEfectivo(), no esta lista.
const MEDIOS = ['Efectivo', 'QR', 'Llave', 'Nequi', 'Daviplata', 'Tarjeta', 'Transferencia'];

const EFECTIVO = 'Efectivo';

// Compara sin distinguir mayusculas ni espacios: los pagos ya guardados vienen
// del <select>, pero basta un cambio de etiqueta para que 'efectivo' deje de
// coincidir y el dinero se salga del arqueo sin que nadie lo note.
function esEfectivo(metodo) {
  return String(metodo || '').trim().toLowerCase() === EFECTIVO.toLowerCase();
}

function esMedioValido(metodo) {
  return MEDIOS.some(m => m.toLowerCase() === String(metodo || '').trim().toLowerCase());
}

module.exports = { MEDIOS, EFECTIVO, esEfectivo, esMedioValido };
