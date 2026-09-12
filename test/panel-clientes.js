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

    // ---- Dar de baja a un cliente ----------------------------------------
    // Lo que faltaba para poder quitar de en medio a alguien sin perder lo que
    // pago. Lo unico que existia era vaciar la zona de clientes entera desde el
    // panel de desarrollador, que se lleva a TODOS por delante.
    //
    // Lo que se prueba, sobre todo, es lo que NO hace: no borra.
    const recordatorios = require('../electron/services/recordatorios');
    const identificacion = require('../electron/services/identificacion');

    const baja = clientes.crear({ documento: '90001', nombre: 'Se Va Del Gym',
                                  telefono: '3009990000', email: 'sevadelgym@gmail.com' });
    const suMembresia = membresias.vender({ clienteId: baja, planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: suMembresia, monto: 70000, metodo: 'Efectivo', usuarioId });
    asistencias.registrar({ clienteId: baja, metodo: 'pin', registradoPor: usuarioId });
    await clientes.asignarPin(baja, '4321');

    const contarTodo = () => ({
      clientes: db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n,
      membresias: db.prepare('SELECT COUNT(*) AS n FROM membresias').get().n,
      pagos: db.prepare('SELECT COUNT(*) AS n FROM pagos').get().n,
      asistencias: db.prepare('SELECT COUNT(*) AS n FROM asistencias').get().n,
    });
    const antesDeLaBaja = JSON.stringify(contarTodo());
    const saleEnBusqueda = () => clientes.buscar('Se Va Del Gym').length > 0;
    const censoLoCuenta = () => recordatorios.censoCorreos().total;
    const censoAntes = censoLoCuenta();

    check('antes de la baja, el cliente sale en la busqueda', saleEnBusqueda());
    check('y el kiosco lo reconoce con sus 4 digitos y su PIN',
          (await identificacion.identificarPorDocumentoYPin('0001', '4321')).ok === true);

    const r = clientes.darDeBaja({ clienteId: baja, usuarioId, motivo: 'se mudo de ciudad' });
    check('dar de baja responde ok y dice cuantas membresias vivas tenia',
          r.ok === true && r.membresiasVivas === 1, JSON.stringify(r));

    // Lo importante: NO BORRA.
    check('dar de baja no borra absolutamente nada',
          JSON.stringify(contarTodo()) === antesDeLaBaja,
          antesDeLaBaja + ' -> ' + JSON.stringify(contarTodo()));

    // Y desaparece de los cuatro sitios que ya filtraban por activo = 1.
    check('deja de salir en la busqueda', !saleEnBusqueda());
    check('deja de contar en el censo de correos', censoLoCuenta() === censoAntes - 1,
          censoAntes + ' -> ' + censoLoCuenta());
    check('deja de contar en el panel de Clientes',
          !panel.panelLateral().noPuedenEntrenar.some(c => c.id === baja) &&
          !panel.buscarConEstado('Se Va Del Gym').some(c => c.id === baja));
    const enKiosco = await identificacion.identificarPorDocumentoYPin('0001', '4321');
    check('y el kiosco deja de reconocerlo, aunque el PIN siga siendo el bueno',
          enKiosco.ok === false && enKiosco.motivo === 'no_registrado', JSON.stringify(enKiosco));

    // Queda escrito quien, cuando y por que.
    const anotado = db.prepare(
      `SELECT * FROM auditoria WHERE entidad = 'clientes' AND entidad_id = ? AND accion = 'cliente_baja'`
    ).get(baja);
    check('la baja queda anotada en auditoria con su motivo',
          !!anotado && JSON.parse(anotado.detalle).motivo === 'se mudo de ciudad',
          anotado ? anotado.detalle : 'no se anoto');

    // Y se puede encontrar para deshacerlo: sin esto seria una puerta de un solo
    // sentido, porque el cliente ya no sale en ninguna busqueda.
    const lista = clientes.listarDadosDeBaja();
    const suyo = lista.find(c => c.id === baja);
    check('el dado de baja se puede encontrar en su propia lista',
          !!suyo, JSON.stringify(lista.map(c => c.nombre)));
    check('y esa lista trae la fecha y el motivo, para reconocer el error',
          suyo.motivo === 'se mudo de ciudad' && /^\d{4}-\d{2}-\d{2}/.test(suyo.fechaBaja || ''),
          JSON.stringify(suyo));

    // Hugo lleva inactivo desde el principio de esta suite, puesto a mano y sin
    // pasar por darDeBaja(). Representa a los que ya estaban con activo = 0
    // antes de que esta funcion existiera: tienen que salir igual, o quedarian
    // atrapados fuera para siempre. Salen sin fecha ni motivo, que es la verdad:
    // nadie la anoto.
    const heredado = lista.find(c => c.nombre === 'Hugo Inactivo');
    check('los que ya estaban inactivos de antes tambien salen en la lista',
          !!heredado && heredado.fechaBaja === null && heredado.motivo === null,
          JSON.stringify(heredado));

    check('dar de baja dos veces no rompe ni duplica la anotacion',
          clientes.darDeBaja({ clienteId: baja, usuarioId }).yaEstaba === true &&
          db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE entidad_id = ? AND accion = 'cliente_baja'`)
            .get(baja).n === 1);

    // Deshacerlo lo devuelve entero.
    clientes.reactivar({ clienteId: baja, usuarioId });
    check('darlo de alta lo devuelve a la busqueda', saleEnBusqueda());
    check('y con todo su historial intacto',
          JSON.stringify(contarTodo()) === antesDeLaBaja &&
          membresias.listarPorCliente(baja).length === 1);
    check('el censo vuelve a contarlo', censoLoCuenta() === censoAntes);
    check('y el kiosco vuelve a reconocerlo con el mismo PIN de siempre',
          (await identificacion.identificarPorDocumentoYPin('0001', '4321')).ok === true);
    check('y ya no sale en la lista de dados de baja',
          !clientes.listarDadosDeBaja().some(c => c.id === baja),
          JSON.stringify(clientes.listarDadosDeBaja().map(c => c.nombre)));

    check('dar de baja a alguien que no existe avisa en vez de reventar',
          clientes.darDeBaja({ clienteId: 99999, usuarioId }).motivo === 'no_existe' &&
          clientes.reactivar({ clienteId: 99999, usuarioId }).motivo === 'no_existe');

    // -------------------------------------------------------------------
    // Buscar como se teclea en el mostrador: sin tildes y sin respetar
    // mayusculas. El control del gimnasio trae los nombres en mayuscula.
    // -------------------------------------------------------------------
    clientes.crear({ documento: '5555000001', nombre: 'ALEXANDRA SALDAÑO', telefono: '320' });
    clientes.crear({ documento: '5555000002', nombre: 'José Muñoz Peña', telefono: '321' });
    clientes.crear({ documento: '5555000003', nombre: 'DARLY', telefono: '322' });

    const porNombre = clientes.buscar('alexandra');
    check('encuentra por el nombre de pila en minusculas',
          porNombre.length === 1 && porNombre[0].nombre === 'ALEXANDRA SALDAÑO');

    // Lo que antes no funcionaba: la ENE no la doblaba LIKE.
    const porApellido = clientes.buscar('saldano');
    check('encuentra por el apellido escrito sin la ene',
          porApellido.length === 1 && porApellido[0].documento === '5555000001',
          'resultados=' + porApellido.length);
    check('y tambien escribiendolo con ene minuscula',
          clientes.buscar('saldaño').length === 1);

    check('encuentra por el apellido suelto',
          clientes.buscar('munoz').length === 1);
    check('por el segundo apellido tambien',
          clientes.buscar('pena').length === 1);
    check('por el nombre completo escrito sin tildes',
          clientes.buscar('jose munoz pena').length === 1);
    check('y con las tildes puestas',
          clientes.buscar('José Muñoz Peña').length === 1);

    // Un cliente con un solo nombre tiene que encontrarse igual.
    check('un cliente sin apellido se encuentra por su unico nombre',
          clientes.buscar('darly').length === 1);

    check('la cedula sigue funcionando como antes',
          clientes.buscar('5555000002').length === 1);

    // Editar el nombre tiene que mover tambien la columna de busqueda; si no,
    // el cliente se quedaria encontrable solo por su nombre viejo.
    const paraRenombrar = clientes.buscar('darly')[0].id;
    clientes.editar(paraRenombrar, {
      documento: '5555000003', nombre: 'DARLY GUZMÁN', telefono: '322',
      email: null, foto: null, f_nacimiento: null, contacto_emg: null, notas: null,
    });
    check('al renombrar se puede buscar por el apellido nuevo',
          clientes.buscar('guzman').length === 1);

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
