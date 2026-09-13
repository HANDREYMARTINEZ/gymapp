import { useEffect, useRef } from 'react';
import { crearDetector } from './detector.mjs';

// El lector de codigos de barras para toda la app. Se instala UNA vez en App y
// escucha el teclado antes que nadie (fase de captura en window).
//
// Cuando detecta un escaneo hace tres cosas:
//
//  1. Deshace lo que el lector alcanzo a teclear. Cuando llega el primer
//     caracter todavia no se sabe si es el lector o una persona, asi que los
//     digitos ya han caido en el campo con foco -- la cantidad del carrito, el
//     PIN del kiosco. Por eso se apunta el valor de cada campo ANTES de su primer
//     caracter de la rafaga, y al confirmar el escaneo se le devuelve. Si era una
//     persona no se toca nada: no se traga ni una tecla.
//  2. Se come el Enter, para que no dispare lo que ese campo haga con Enter
//     (marcar asistencia en el kiosco, buscar en Vender).
//  3. Le entrega el codigo a la pantalla que este escuchando. Si ninguna
//     escucha -- Kiosco, Clientes, Login -- el escaneo simplemente no hace nada.

// Pila y no un unico oyente: dentro de Inventario se abre el formulario de
// producto, y mientras esta abierto el codigo es suyo, no de la lista de detras.
const oyentes = [];

// Contadores para las pruebas de ventana (test/lector-ventana.js) y para
// diagnosticar: cuantos escaneos se detectaron y cuantos no tuvieron a quien ir.
const cuenta = { detectados: 0, sinOyente: 0, ultimo: null };

function restaurar(el, valor) {
  if (!el || el.value === valor) return;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
              : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
              : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) return;
  // Asignar .value a secas no avisa a React y el estado se quedaria con los
  // digitos del lector. El setter nativo mas el evento si lo sincroniza.
  setter.call(el, valor);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

function editable(el) {
  return el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement);
}

export function instalarLectorGlobal() {
  const detector = crearDetector();
  let tocados = new Map(); // campo -> valor que tenia antes de la rafaga

  function alPulsar(e) {
    const r = detector.tecla(e.key, e.timeStamp, e.repeat);

    if (r.tipo === 'caracter') {
      if (r.empieza) tocados = new Map();
      // keydown llega ANTES de que el caracter entre en el campo: el valor que se
      // lee aqui todavia es el bueno.
      const el = document.activeElement;
      if (editable(el) && !tocados.has(el)) tocados.set(el, el.value);
      return;
    }

    if (r.tipo === 'codigo') {
      e.preventDefault();
      e.stopImmediatePropagation();
      for (const [el, valor] of tocados) restaurar(el, valor);
      tocados = new Map();

      cuenta.detectados++;
      cuenta.ultimo = r.codigo;
      const oyente = oyentes[oyentes.length - 1];
      if (oyente) oyente(r.codigo);
      else cuenta.sinOyente++;
    }
  }

  window.addEventListener('keydown', alPulsar, true);
  window.__lector = cuenta;
  return () => window.removeEventListener('keydown', alPulsar, true);
}

// Una pantalla que quiere los codigos escaneados. `activo` permite dejar de
// escuchar sin desmontar (Inventario deja de escuchar mientras hay un
// formulario abierto encima, que escucha el suyo).
export function useCodigoEscaneado(alEscanear, activo = true) {
  const ref = useRef(alEscanear);
  ref.current = alEscanear;

  useEffect(() => {
    if (!activo) return undefined;
    const oyente = (codigo) => ref.current(codigo);
    oyentes.push(oyente);
    return () => {
      const i = oyentes.lastIndexOf(oyente);
      if (i >= 0) oyentes.splice(i, 1);
    };
  }, [activo]);
}
