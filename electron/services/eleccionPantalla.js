// En que monitor va el kiosco de los clientes. Sin electron dentro, para poder
// probarlo con tres o cuatro pantallas de mentira (test/pantalla-kiosco.js).
//
// Con dos monitores no hay nada que elegir: va en el que no es el de
// recepcion. Con tres, "el primero que no sea el de recepcion" depende del orden
// en que Windows los enumere, y puede ser justo el que nadie mira. Por eso se
// puede elegir en Configuracion (pedido el 07-oct-2026) y se guarda en config.

// Las pantallas se numeran de izquierda a derecha (y de arriba abajo si estan
// apiladas), que es como las ve quien esta en el mostrador. Es el mismo numero
// que sale en grande al pulsar "Identificar".
function numerar(pantallas) {
  return [...pantallas]
    .sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y))
    .map((p, i) => ({ ...p, numero: i + 1 }));
}

// Se guarda el id Y el modelo del monitor ("VA249HG"). El id lo calcula Windows
// a partir de como esta conectado, y puede cambiar si se pasa el cable a otro
// puerto de la tarjeta o se actualiza el driver; el modelo no. Se busca primero
// por id y, si no esta, por modelo -- pero solo si hay UNO de ese modelo: con
// dos monitores iguales el modelo no dice cual es cual, y adivinar podria poner
// el kiosco en la pantalla de recepcion.
function buscarGuardada(pantallas, guardada) {
  if (!guardada) return null;
  const porId = pantallas.find(p => p.id === guardada.id);
  if (porId) return porId;
  if (!guardada.label) return null;
  const mismoModelo = pantallas.filter(p => p.label === guardada.label);
  return mismoModelo.length === 1 ? mismoModelo[0] : null;
}

// Devuelve { destino, aviso }:
//   destino: la pantalla donde abrir a pantalla completa, o null = en ventana
//            (solo hay un monitor).
//   aviso:   por que no se uso la elegida, para decirlo en el menu.
//            'elegida_no_esta'     - desconectada o no se reconoce
//            'elegida_es_recepcion' - ahi esta ahora la ventana principal, y el
//                                     kiosco a pantalla completa la taparia
function elegirDestino(pantallas, idRecepcion, guardada) {
  const numeradas = numerar(pantallas);
  if (numeradas.length < 2) return { destino: null, aviso: null };

  let aviso = null;
  const elegida = buscarGuardada(numeradas, guardada);
  if (guardada && !elegida) aviso = 'elegida_no_esta';
  else if (elegida && elegida.id === idRecepcion) aviso = 'elegida_es_recepcion';
  else if (elegida) return { destino: elegida, aviso: null };

  const otra = numeradas.find(p => p.id !== idRecepcion) || null;
  return { destino: otra, aviso };
}

module.exports = { numerar, buscarGuardada, elegirDestino };
