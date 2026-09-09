const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-panel-clientes-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-panel-clientes-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const { format, addDays, subDays } = require('date-fns');
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();
    const panel = require('../electron/db/repos/panel-clientes');
    const membresias = require('../electron/db/repos/membresias');
    const planes = require('../electron/db/repos/planes');
    const clientes = require('../electron/db/repos/clientes');
    const pausas = require('../electron/db/repos/pausas');
    const caja = require('../electron/db/repos/caja');
    const asistencias = require('../electron/db/repos/asistencias');

    const enDias = (n) => format(addDays(new Date(), n), 'yyyy-MM-dd');
    const haceDias = (n) => format(subDays(new Date(), n), 'yyyy-MM-dd');

    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Cajero', 'cajero', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;
    caja.abrir({ usuarioId, baseInicial: 100000 });

    const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 70000, dias_duracion: 30 });
    const bono = planes.crear({ nombre: 'Bono 10', tipo: 'ticketera', precio: 90000, num_tickets: 10, dias_vigencia: 60 });

    const nuevo = (nombre, doc) => clientes.crear({ documento: doc, nombre, telefono: '300' + doc });
    const pagar = (id, monto) => membresias.registrarPago({ membresiaId: id, monto, metodo: 'Efectivo', usuarioId });

    // Al dia
    const alDia = nuevo('Ana Activa', '111');
    pagar(membresias.vender({ clienteId: alDia, planId: mensual, usuarioId }), 70000);

    // Debe dinero
    const debe = nuevo('Beto Debe', '222');
    const mDebe = membresias.vender({ clienteId: debe, planId: mensual, usuarioId });
    pagar(mDebe, 30000);

    // Vencido
    const vencido = nuevo('Cesar Vencido', '333');
    pagar(membresias.vender({ clienteId: vencido, planId: mensual, usuarioId, fInicio: haceDias(60) }), 70000);

    // Sin tickets
    const sinTickets = nuevo('Dania SinTickets', '444');
    const mBono = membresias.vender({ clienteId: sinTickets, planId: bono, usuarioId });
    pagar(mBono, 90000);
    db.prepare(`UPDATE membresias SET tickets_usados = tickets_totales WHERE id = ?`).run(mBono);

    // Nunca compro nada
    const nunca = nuevo('Elsa Nunca', '555');

    // Pausado
    const pausado = nuevo('Fabio Pausado', '666');
    const mPausa = membresias.vender({ clienteId: pausado, planId: mensual, usuarioId });
    pagar(mPausa, 70000);
    pausas.pausar({ membresiaId: mPausa, motivo: 'viaje', usuarioId });

    // Programado
    const programado = nuevo('Gina Programada', '777');
    pagar(membresias.vender({ clienteId: programado, planId: mensual, usuarioId, fInicio: enDias(10) }), 70000);

    // Inactivo: no deberia salir en ningun bloque
    const fuera = nuevo('Hugo Inactivo', '888');
    pagar(membresias.vender({ clienteId: fuera, planId: mensual, usuarioId, fInicio: haceDias(60) }), 70000);
    db.prepare(`UPDATE clientes SET activo = 0 WHERE id = ?`).run(fuera);

    // ------------------------------------------------- lista de la izquierda
    const todos = panel.buscarConEstado('');
    check('con el buscador vacio devuelve la lista completa, no vacia',
          todos.length === 7, 'devolvio ' + todos.length);
    check('y no incluye a los clientes dados de baja',
          !todos.some(c => c.nombre === 'Hugo Inactivo'));

    const estadoDe = (lista, nombre) => (lista.find(c => c.nombre === nombre) || {}).estado;
    check('marca al dia como activa', estadoDe(todos, 'Ana Activa') === 'activa',
          estadoDe(todos, 'Ana Activa'));
    check('marca al que debe como saldo pendiente',
          estadoDe(todos, 'Beto Debe') === 'saldo_pendiente', estadoDe(todos, 'Beto Debe'));
    check('marca al vencido como vencida', estadoDe(todos, 'Cesar Vencido') === 'vencida',
          estadoDe(todos, 'Cesar Vencido'));
    check('marca al de la ticketera gastada como agotada',
          estadoDe(todos, 'Dania SinTickets') === 'agotada', estadoDe(todos, 'Dania SinTickets'));
    check('marca al que nunca compro como sin membresia',
          estadoDe(todos, 'Elsa Nunca') === 'sin_membresia', estadoDe(todos, 'Elsa Nunca'));
    check('marca al pausado como pausada', estadoDe(todos, 'Fabio Pausado') === 'pausada',
          estadoDe(todos, 'Fabio Pausado'));
    check('marca a la programada como programada',
          estadoDe(todos, 'Gina Programada') === 'programada', estadoDe(todos, 'Gina Programada'));

    // El punto del bloque: que coincida con lo que hace el kiosco de verdad.
    for (const [nombre, id] of [['Ana Activa', alDia], ['Beto Debe', debe], ['Cesar Vencido', vencido],
                                ['Dania SinTickets', sinTickets], ['Elsa Nunca', nunca],
                                ['Fabio Pausado', pausado], ['Gina Programada', programado]]) {
      const dice = todos.find(c => c.nombre === nombre).puedeEntrenar;
      const kiosco = asistencias.registrar({ clienteId: id, metodo: 'pin', registradoPor: usuarioId }).ok;
      check('"puede entrenar" de ' + nombre + ' coincide con lo que hace el kiosco',
            dice === kiosco, 'listado=' + dice + ' kiosco=' + kiosco);
    }

    check('el buscador filtra por nombre',
          panel.buscarConEstado('Beto').length === 1);
    check('y tambien por documento',
          panel.buscarConEstado('333')[0].nombre === 'Cesar Vencido');
    check('una busqueda sin coincidencias devuelve vacio, no todo',
          panel.buscarConEstado('zzzz').length === 0);

    // -------------------------------------------------- bloques de la derecha
    let lat = panel.panelLateral();
    check('el bloque de saldo trae solo a quien debe',
          lat.conSaldo.length === 1 && lat.conSaldo[0].nombre === 'Beto Debe',
          lat.conSaldo.map(c => c.nombre).join(', '));
    check('y dice cuanto debe', lat.conSaldo[0].saldoPendiente === 40000,
          'saldo=' + lat.conSaldo[0].saldoPendiente);
    check('e indica que membresia hay que pagar',
          lat.conSaldo[0].membresiasConSaldo.length === 1 &&
          lat.conSaldo[0].membresiasConSaldo[0].id === mDebe);

    const noPueden = lat.noPuedenEntrenar.map(c => c.nombre);
    check('el bloque de "no pueden entrenar" trae al vencido y al de sin tickets',
          noPueden.length === 2 && noPueden.includes('Cesar Vencido') && noPueden.includes('Dania SinTickets'),
          noPueden.join(', '));
    check('y no mete ahi al que solo debe dinero', !noPueden.includes('Beto Debe'));
    check('ni al pausado, que es otra cosa', !noPueden.includes('Fabio Pausado'));
    check('ni al cliente dado de baja', !noPueden.includes('Hugo Inactivo'));

    // --------------------------------- pagar saca al cliente del bloque
    pagar(mDebe, 40000);
    lat = panel.panelLateral();
    check('al terminar de pagar, el cliente sale del bloque de saldo',
          lat.conSaldo.length === 0, 'quedan ' + lat.conSaldo.length);
    check('y su estado en la lista pasa a activa',
          estadoDe(panel.buscarConEstado(''), 'Beto Debe') === 'activa');

    // Un abono parcial no lo saca: sigue debiendo.
    const otro = nuevo('Ivan Abona', '999');
    const mIvan = membresias.vender({ clienteId: otro, planId: mensual, usuarioId });
    pagar(mIvan, 10000);
    check('un abono parcial no lo saca del bloque',
          panel.panelLateral().conSaldo.some(c => c.nombre === 'Ivan Abona'));

    // ------------------------------------- suma de varias membresias a medias
    const mIvan2 = membresias.vender({ clienteId: otro, planId: bono, usuarioId });
    pagar(mIvan2, 20000);
    const ivan = panel.panelLateral().conSaldo.find(c => c.nombre === 'Ivan Abona');
    check('con dos membresias a medias suma los dos saldos',
          ivan.saldoPendiente === 60000 + 70000, 'saldo=' + ivan.saldoPendiente);
    check('y lista las dos para poder abonar a cada una',
          ivan.membresiasConSaldo.length === 2, 'listadas=' + ivan.membresiasConSaldo.length);

    db.close();
  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallos === 0 ? 0 : 1);
});
