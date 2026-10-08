const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// En que monitor sale el kiosco de los clientes (electron/services/
// eleccionPantalla.js), con dos, tres y cuatro pantallas de mentira. No abre
// ninguna ventana ni necesita monitores de verdad.

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-pantalla-kiosco-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const pantalla = (id, label, x, y, ancho, alto) => ({ id, label, bounds: { x, y, width: ancho || 1920, height: alto || 1080 } });

app.whenReady().then(() => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const { numerar, buscarGuardada, elegirDestino } = require('../electron/services/eleccionPantalla');

    // Windows las enumera en cualquier orden: aqui, la del medio primero.
    const centro = pantalla(30, 'VA249HG', 0, 0);
    const izquierda = pantalla(10, 'LED MONITOR', -1360, 200, 1360, 768);
    const derecha = pantalla(20, 'TV SALA', 1920, 0);
    const tres = [centro, derecha, izquierda];

    const n = numerar(tres);
    check('se numeran de izquierda a derecha, no en el orden de Windows',
          n.map(p => p.id).join(',') === '10,30,20', n.map(p => p.numero + ':' + p.id).join(' '));
    check('numerar no toca la lista original', tres[0].id === 30 && !('numero' in tres[0]));

    const apiladas = numerar([pantalla(2, 'B', 0, 1080), pantalla(1, 'A', 0, 0)]);
    check('apiladas en vertical, de arriba abajo', apiladas[0].id === 1 && apiladas[1].id === 2);

    // ---------------------------------------------------------- una y dos
    const una = elegirDestino([centro], 30, null);
    check('con una sola pantalla se abre en ventana', una.destino === null && una.aviso === null);
    check('con una sola pantalla, aunque haya una elegida, no avisa de nada',
          elegirDestino([centro], 30, { id: 20, label: 'TV SALA' }).aviso === null);

    const dos = elegirDestino([centro, derecha], 30, null);
    check('con dos, sin elegir, va en la que no es la de recepcion', dos.destino && dos.destino.id === 20);

    // ----------------------------------------------------------------- tres
    const auto = elegirDestino(tres, 30, null);
    check('con tres, sin elegir, va en la primera de izquierda a derecha que no es recepcion',
          auto.destino && auto.destino.id === 10 && auto.aviso === null);
    const autoIzq = elegirDestino(tres, 10, null);
    check('si recepcion es la de la izquierda, salta a la siguiente', autoIzq.destino && autoIzq.destino.id === 30);

    const elegida = elegirDestino(tres, 30, { id: 20, label: 'TV SALA' });
    check('con tres y una elegida, va en la elegida', elegida.destino && elegida.destino.id === 20 && elegida.aviso === null);
    check('y el destino lleva su numero', elegida.destino.numero === 3);

    // El id cambia (otro puerto de la tarjeta, driver nuevo) pero el modelo no.
    const otroId = elegirDestino([centro, izquierda, pantalla(99, 'TV SALA', 1920, 0)], 30, { id: 20, label: 'TV SALA' });
    check('si Windows le cambio el id, se reconoce por el modelo', otroId.destino && otroId.destino.id === 99 && otroId.aviso === null);

    // Dos monitores del mismo modelo: el modelo no dice cual es cual.
    const gemelos = [centro, pantalla(41, 'IGUAL', 1920, 0), pantalla(42, 'IGUAL', 3840, 0)];
    check('con dos del mismo modelo NO se adivina por el modelo',
          buscarGuardada(gemelos, { id: 40, label: 'IGUAL' }) === null);
    check('pero por id si se encuentra', buscarGuardada(gemelos, { id: 42, label: 'IGUAL' }).id === 42);
    const sinAdivinar = elegirDestino(gemelos, 30, { id: 40, label: 'IGUAL' });
    check('y entonces avisa de que la elegida no esta y usa la automatica',
          sinAdivinar.aviso === 'elegida_no_esta' && sinAdivinar.destino.id === 41);

    const desconectada = elegirDestino([centro, izquierda], 30, { id: 20, label: 'TV SALA' });
    check('si la elegida esta desconectada, avisa y la pone en otra',
          desconectada.aviso === 'elegida_no_esta' && desconectada.destino && desconectada.destino.id === 10);

    // Alguien arrastro GymApp a la pantalla elegida: el kiosco la taparia.
    const tapa = elegirDestino(tres, 20, { id: 20, label: 'TV SALA' });
    check('si GymApp esta en la elegida, NO la tapa: avisa y usa otra',
          tapa.aviso === 'elegida_es_recepcion' && tapa.destino && tapa.destino.id !== 20, JSON.stringify(tapa));

    // --------------------------------------------------------------- cuatro
    const cuatro = [...tres, pantalla(50, 'PROYECTOR', 3840, 0)];
    const c = elegirDestino(cuatro, 30, { id: 50, label: 'PROYECTOR' });
    check('con cuatro tambien va en la elegida', c.destino && c.destino.id === 50 && c.destino.numero === 4);

    check('ningun destino es nunca la pantalla de recepcion',
          [auto, autoIzq, elegida, otroId, sinAdivinar, desconectada, tapa, c, dos]
            .every((r, i) => !r.destino || r.destino.id !== [30, 10, 30, 30, 30, 30, 20, 30, 30][i]));
  } catch (e) {
    log('FALLA excepcion: ' + (e && e.stack || e));
    fallos++;
  }

  log('');
  log(fallos === 0 ? 'TODO OK' : 'FALLOS: ' + fallos);
  volcar();
  app.exit(fallos === 0 ? 0 : 1);
});
