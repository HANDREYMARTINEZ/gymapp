// El detector del lector de codigos de barras, sin nada de ventana ni de React
// para poder probarlo desde las suites (test/lector.js).
//
// POR QUE HACE FALTA
// ------------------
// El lector (SAT LD101R PLUS) es USB-HID: Windows lo ve como un TECLADO. Lee el
// codigo y lo "teclea", seguido de un Enter, en lo que tenga el foco. No hay
// driver ni puerto que escuchar. El 12-sep tecleo "7700304572069" dos veces en
// el chat de Claude, que es lo que hace en cualquier campo: la cantidad del
// carrito, el PIN del kiosco, la contrasena del login.
//
// COMO LO DISTINGUE DE UNA PERSONA
// --------------------------------
// Por la velocidad. El lector teclea un codigo entero en unos milisegundos; una
// persona no baja de ~60 ms entre tecla y tecla, y desde luego no lo sostiene
// cuatro teclas seguidas mas un Enter.
//
// Lo que tiene que sobrevivir:
//   - Tecla mantenida pulsada: Windows la repite cada ~30 ms, que es tan rapido
//     como el lector. Mantener un "1" y soltar con Enter pareceria un codigo.
//     Por eso las pulsaciones repetidas (event.repeat) cortan la rafaga.
//   - Codigos con mayusculas (Code 39, Code 128): el lector manda Shift entre
//     letra y letra. Shift, Control, Alt y compania ni cuentan ni cortan.
//   - Cualquier otra tecla que no escribe (Tab, flechas, Borrar) corta.

export const AJUSTES = {
  // Hueco maximo entre dos caracteres de un mismo codigo. Ver el medido de
  // verdad con `npm run lector`.
  MAX_ENTRE_TECLAS_MS: 45,
  // El Enter final llega igual de pegado. Algo mas de margen por si acaso.
  MAX_ANTES_DEL_ENTER_MS: 100,
  // Por debajo de esto no se trata como codigo. EAN-8, el mas corto habitual,
  // tiene 8; se deja en 4 para codigos internos cortos.
  MIN_LARGO: 4,
};

const MODIFICADORES = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);

export function crearDetector(ajustes = AJUSTES) {
  const { MAX_ENTRE_TECLAS_MS, MAX_ANTES_DEL_ENTER_MS, MIN_LARGO } = { ...AJUSTES, ...ajustes };
  let rafaga = '';
  let ultima = -Infinity;

  const cortar = () => { rafaga = ''; ultima = -Infinity; };

  // Recibe cada pulsacion y contesta que es:
  //   { tipo: 'caracter', empieza }  un caracter; empieza=true si abre rafaga
  //   { tipo: 'codigo', codigo }     el Enter que cierra un escaneo
  //   { tipo: 'nada' }               cualquier otra cosa
  function tecla(key, instante, repetida) {
    if (MODIFICADORES.has(key)) return { tipo: 'nada' };

    if (repetida) { cortar(); return { tipo: 'nada' }; }

    if (key === 'Enter') {
      const esCodigo = rafaga.length >= MIN_LARGO && (instante - ultima) <= MAX_ANTES_DEL_ENTER_MS;
      const codigo = rafaga;
      cortar();
      return esCodigo ? { tipo: 'codigo', codigo } : { tipo: 'nada' };
    }

    if (typeof key !== 'string' || key.length !== 1) { cortar(); return { tipo: 'nada' }; }

    const empieza = (instante - ultima) > MAX_ENTRE_TECLAS_MS;
    rafaga = empieza ? key : rafaga + key;
    ultima = instante;
    return { tipo: 'caracter', empieza };
  }

  return { tecla, cortar };
}
