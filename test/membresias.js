const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-membresias-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-membresias-' + Date.now());
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
    const membresias = require('../electron/db/repos/membresias');
    const planes = require('../electron/db/repos/planes');
    const clientes = require('../electron/db/repos/clientes');
    const caja = require('../electron/db/repos/caja');
    const asistencias = require('../electron/db/repos/asistencias');

    const hoy = format(new Date(), 'yyyy-MM-dd');
    const enDias = (n) => format(addDays(new Date(), n), 'yyyy-MM-dd');
    const haceDias = (n) => format(subDays(new Date(), n), 'yyyy-MM-dd');

    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Cajero', 'cajero', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;

    const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 70000, dias_duracion: 30 });
    const retirado = planes.crear({ nombre: 'Promo vieja', tipo: 'periodo', precio: 50000, dias_duracion: 30 });
    const ana = clientes.crear({ documento: '111', nombre: 'Ana', telefono: '300' });
    const beto = clientes.crear({ documento: '222', nombre: 'Beto', telefono: '301' });

    const estadoDe = (clienteId, membresiaId) =>
      membresias.listarPorCliente(clienteId).find(m => m.id === membresiaId).estado;

    // ---------------------------------------------------------------- fecha
    // Sin fecha explicita se comporta igual que siempre: es lo que no se puede
    // romper al anadir el calendario.
    const sinFecha = membresias.vender({ clienteId: ana, planId: mensual, usuarioId });
    const mSinFecha = db.prepare('SELECT * FROM membresias WHERE id = ?').get(sinFecha);
    check('sin fecha explicita sigue empezando hoy', mSinFecha.f_inicio === hoy, mSinFecha.f_inicio);
    check('y calcula el fin con los dias del plan', mSinFecha.f_fin === enDias(29), mSinFecha.f_fin);

    const conFecha = membresias.vender({
      clienteId: beto, planId: mensual, usuarioId, fInicio: haceDias(10),
    });
    const mConFecha = db.prepare('SELECT * FROM membresias WHERE id = ?').get(conFecha);
    check('con fecha explicita empieza donde se le dijo', mConFecha.f_inicio === haceDias(10),
          mConFecha.f_inicio);
    check('y el fin se recalcula desde esa fecha, no desde hoy',
          mConFecha.f_fin === format(addDays(new Date(mConFecha.f_inicio + 'T00:00:00'), 29), 'yyyy-MM-dd'),
          mConFecha.f_fin);
    // El saldo pendiente tapa cualquier otro estado, asi que para mirar el estado
    // que interesa hay que dejar la membresia pagada.
    caja.abrir({ usuarioId, baseInicial: 100000 });
    const pagarEntera = (id) => membresias.registrarPago(
      { membresiaId: id, monto: 70000, metodo: 'Efectivo', usuarioId });

    pagarEntera(conFecha);
    check('una membresia empezada hace 10 dias esta activa',
          estadoDe(beto, conFecha) === 'activa', estadoDe(beto, conFecha));

    for (const mala of ['ayer', '2026-13-45', '01/02/2026', '2026-2-3', 12345]) {
      let lanzo = false;
      try { membresias.vender({ clienteId: ana, planId: mensual, usuarioId, fInicio: mala }); }
      catch (e) { lanzo = true; }
      check('rechaza la fecha invalida ' + JSON.stringify(mala), lanzo);
    }

    // ------------------------------------------------------------ programada
    // El agujero que abre el calendario: vender algo que empieza mas adelante.
    const futura = membresias.vender({ clienteId: ana, planId: mensual, usuarioId, fInicio: enDias(15) });
    pagarEntera(futura);
    check('una membresia que empieza mas adelante queda programada, no activa',
          estadoDe(ana, futura) === 'programada', estadoDe(ana, futura));

    const cesar = clientes.crear({ documento: '333', nombre: 'Cesar', telefono: '302' });
    pagarEntera(membresias.vender({ clienteId: cesar, planId: mensual, usuarioId, fInicio: enDias(15) }));
    const entrada = asistencias.registrar({ clienteId: cesar, metodo: 'pin', registradoPor: usuarioId });
    check('y el kiosco no la deja entrar todavia',
          entrada.ok === false && entrada.motivo === 'programada', 'motivo=' + entrada.motivo);

    // --------------------------------------------------------------- renovar
    const dania = clientes.crear({ documento: '444', nombre: 'Dania', telefono: '303' });
    const original = membresias.vender({ clienteId: dania, planId: mensual, usuarioId });
    const ren = membresias.renovar({ membresiaId: original, usuarioId });
    check('renovar crea una membresia nueva', ren.ok === true && ren.membresiaId !== original,
          'motivo=' + ren.motivo);

    const nueva = db.prepare('SELECT * FROM membresias WHERE id = ?').get(ren.membresiaId);
    check('la renovacion usa el mismo plan', nueva.plan_id === mensual);
    check('y empieza justo cuando termina la anterior, no hoy',
          nueva.f_inicio === enDias(30), nueva.f_inicio);
    check('la original sigue intacta',
          db.prepare('SELECT anulada FROM membresias WHERE id = ?').get(original).anulada === 0);

    const renFecha = membresias.renovar({ membresiaId: original, usuarioId, fInicio: enDias(60) });
    check('renovar tambien acepta fecha elegida a mano',
          db.prepare('SELECT f_inicio FROM membresias WHERE id = ?').get(renFecha.membresiaId).f_inicio === enDias(60));

    const conRetirado = membresias.vender({ clienteId: dania, planId: retirado, usuarioId });
    planes.desactivar(retirado);
    const renMuerto = membresias.renovar({ membresiaId: conRetirado, usuarioId });
    check('no deja renovar un plan retirado del catalogo',
          renMuerto.ok === false && renMuerto.motivo === 'plan_inactivo', 'motivo=' + renMuerto.motivo);
    check('renovar algo que no existe avisa en vez de reventar',
          membresias.renovar({ membresiaId: 99999, usuarioId }).motivo === 'no_existe');

    // ---------------------------------------------------------------- anular
    const elsa = clientes.crear({ documento: '555', nombre: 'Elsa', telefono: '304' });
    const deElsa = membresias.vender({ clienteId: elsa, planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: deElsa, monto: 40000, metodo: 'Efectivo', usuarioId });
    membresias.registrarPago({ membresiaId: deElsa, monto: 20000, metodo: 'Nequi', usuarioId });

    const listaElsa = membresias.listarPorCliente(elsa).find(m => m.id === deElsa);
    check('listarPorCliente dice cuanto se pago en efectivo',
          listaElsa.pagadoEfectivo === 40000, 'efectivo=' + listaElsa.pagadoEfectivo);
    check('y no cuenta como efectivo lo pagado por Nequi',
          listaElsa.saldoPendiente === 10000, 'saldo=' + listaElsa.saldoPendiente);

    const cajaAntes = caja.resumen(caja.sesionAbierta().id).esperado;
    const an = membresias.anular({ membresiaId: deElsa, usuarioId, motivo: 'se arrepintio' });
    check('anular funciona', an.ok === true, 'motivo=' + an.motivo);
    check('anula tambien sus pagos', an.pagosAnulados === 2, 'pagos=' + an.pagosAnulados);
    check('la fila sigue en la base, no se borra',
          !!db.prepare('SELECT 1 FROM membresias WHERE id = ?').get(deElsa));
    check('queda marcada como anulada con su motivo',
          db.prepare('SELECT anulada, anulada_motivo FROM membresias WHERE id = ?').get(deElsa).anulada_motivo
            === 'se arrepintio');
    check('el estado pasa a anulada', estadoDe(elsa, deElsa) === 'anulada');
    check('sin devolver, el dinero se queda en caja',
          caja.resumen(caja.sesionAbierta().id).esperado === cajaAntes, caja.resumen(caja.sesionAbierta().id).esperado + ' vs ' + cajaAntes);
    check('deja rastro en auditoria',
          !!db.prepare(`SELECT 1 FROM auditoria WHERE accion = 'membresia_anulada' AND entidad_id = ?`).get(deElsa));
    check('no se puede anular dos veces',
          membresias.anular({ membresiaId: deElsa, usuarioId }).motivo === 'ya_anulada');
    check('anular algo que no existe avisa en vez de reventar',
          membresias.anular({ membresiaId: 99999, usuarioId }).motivo === 'no_existe');

    // --- la otra opcion del dialogo: devolver el efectivo ---
    const fabio = clientes.crear({ documento: '666', nombre: 'Fabio', telefono: '305' });
    const deFabio = membresias.vender({ clienteId: fabio, planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: deFabio, monto: 70000, metodo: 'Efectivo', usuarioId });
    const antesDevolucion = caja.resumen(caja.sesionAbierta().id).esperado;
    const dev = membresias.anular({ membresiaId: deFabio, usuarioId, devolverEfectivo: true });
    check('devolviendo, sale el efectivo de la caja',
          dev.ok && caja.resumen(caja.sesionAbierta().id).esperado === antesDevolucion - 70000,
          antesDevolucion + ' -> ' + caja.resumen(caja.sesionAbierta().id).esperado);
    check('y lo informa', dev.efectivoDevuelto === 70000, 'devuelto=' + dev.efectivoDevuelto);

    // --- sin caja abierta no se puede devolver efectivo ---
    const gina = clientes.crear({ documento: '777', nombre: 'Gina', telefono: '306' });
    const deGina = membresias.vender({ clienteId: gina, planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: deGina, monto: 70000, metodo: 'Efectivo', usuarioId });
    caja.cerrar({ efectivoContado: 0 });

    const sinCaja = membresias.anular({ membresiaId: deGina, usuarioId, devolverEfectivo: true });
    check('sin caja abierta no deja devolver efectivo',
          sinCaja.ok === false && sinCaja.motivo === 'sin_caja_abierta', 'motivo=' + sinCaja.motivo);
    check('y en ese caso NO anula nada: la membresia sigue viva',
          db.prepare('SELECT anulada FROM membresias WHERE id = ?').get(deGina).anulada === 0);
    check('ni toca sus pagos',
          db.prepare(`SELECT anulada FROM pagos WHERE membresia_id = ?`).get(deGina).anulada === 0);
    check('pero sin devolver si se puede anular con la caja cerrada',
          membresias.anular({ membresiaId: deGina, usuarioId }).ok === true);

    // ------------------------------------------------- cambiar fecha de inicio
    const hugo = clientes.crear({ documento: '888', nombre: 'Hugo', telefono: '307' });
    caja.abrir({ usuarioId, baseInicial: 100000 });
    const deHugo = membresias.vender({ clienteId: hugo, planId: mensual, usuarioId, fInicio: hoy });
    const antes = db.prepare('SELECT f_inicio, f_fin FROM membresias WHERE id = ?').get(deHugo);

    const mov = membresias.cambiarFechaInicio({ membresiaId: deHugo, fInicio: haceDias(5), usuarioId });
    const despues = db.prepare('SELECT f_inicio, f_fin FROM membresias WHERE id = ?').get(deHugo);
    check('cambiar la fecha de inicio funciona', mov.ok === true, 'motivo=' + mov.motivo);
    check('el inicio queda donde se dijo', despues.f_inicio === haceDias(5), despues.f_inicio);
    check('el fin se mueve los mismos dias, la membresia dura lo mismo',
          despues.f_fin === format(subDays(new Date(antes.f_fin + 'T00:00:00'), 5), 'yyyy-MM-dd'),
          antes.f_fin + ' -> ' + despues.f_fin);
    check('deja rastro en auditoria',
          !!db.prepare(`SELECT 1 FROM auditoria WHERE accion = 'membresia_fecha_inicio' AND entidad_id = ?`).get(deHugo));

    // Lo importante de todo esto: una membresia que estuvo pausada tiene el fin
    // alargado por la pausa. Recalcularlo como inicio + dias del plan le comeria
    // al cliente los dias que la pausa le devolvio.
    const irene = clientes.crear({ documento: '999', nombre: 'Irene', telefono: '308' });
    const deIrene = membresias.vender({ clienteId: irene, planId: mensual, usuarioId, fInicio: haceDias(20) });
    const pausas = require('../electron/db/repos/pausas');
    pausas.pausar({ membresiaId: deIrene, motivo: 'lesion', usuarioId });
    db.prepare(`UPDATE membresia_pausas SET f_inicio = ? WHERE membresia_id = ?`)
      .run(haceDias(15), deIrene);
    pausas.reactivar(deIrene);

    const conPausa = db.prepare('SELECT f_inicio, f_fin FROM membresias WHERE id = ?').get(deIrene);
    const nominal = format(addDays(new Date(conPausa.f_inicio + 'T00:00:00'), 29), 'yyyy-MM-dd');
    check('la pausa dejo el fin mas alla de inicio + 30 dias', conPausa.f_fin > nominal,
          conPausa.f_fin + ' > ' + nominal);

    const diasDeMas = (a, b) =>
      Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
    const regaladoAntes = diasDeMas(conPausa.f_fin, nominal);

    membresias.cambiarFechaInicio({ membresiaId: deIrene, fInicio: haceDias(18), usuarioId });
    const tras = db.prepare('SELECT f_inicio, f_fin FROM membresias WHERE id = ?').get(deIrene);
    const nominalNuevo = format(addDays(new Date(tras.f_inicio + 'T00:00:00'), 29), 'yyyy-MM-dd');
    check('al mover la fecha NO se pierden los dias que la pausa devolvio',
          diasDeMas(tras.f_fin, nominalNuevo) === regaladoAntes,
          'antes sobraban ' + regaladoAntes + ', ahora ' + diasDeMas(tras.f_fin, nominalNuevo));

    // Ticketera sin vigencia: no hay fin que mover.
    const bono = planes.crear({ nombre: 'Bono suelto', tipo: 'ticketera', precio: 50000, num_tickets: 5 });
    const suelto = membresias.vender({ clienteId: irene, planId: bono, usuarioId });
    check('en una ticketera sin vigencia el fin sigue vacio',
          membresias.cambiarFechaInicio({ membresiaId: suelto, fInicio: haceDias(3), usuarioId }).fFin === null);

    check('la misma fecha no cambia nada',
          membresias.cambiarFechaInicio({ membresiaId: deHugo, fInicio: haceDias(5), usuarioId }).sinCambios === true);
    for (const mala of ['ayer', '2026-13-45', '', null]) {
      check('rechaza mover a la fecha invalida ' + JSON.stringify(mala),
            membresias.cambiarFechaInicio({ membresiaId: deHugo, fInicio: mala, usuarioId }).motivo === 'fecha_invalida');
    }
    check('no deja mover la fecha de una membresia eliminada',
          (() => { membresias.anular({ membresiaId: deHugo, usuarioId });
                   return membresias.cambiarFechaInicio({ membresiaId: deHugo, fInicio: hoy, usuarioId }).motivo; })()
            === 'esta_anulada');
    check('mover la fecha de algo que no existe avisa en vez de reventar',
          membresias.cambiarFechaInicio({ membresiaId: 99999, fInicio: hoy, usuarioId }).motivo === 'no_existe');

    // ---- La migracion 009: el color de los planes sigue a la paleta --------
    const sqlColorPlanes = fs.readFileSync(
      path.join(__dirname, '..', 'electron', 'db', 'migrations', '009_color_planes_amarillo.sql'), 'utf-8');
    const azulViejo = planes.crear({ nombre: 'Con azul viejo', tipo: 'periodo', precio: 1000, dias_duracion: 30, color: '#3b5bdb' });
    const aMano = planes.crear({ nombre: 'Color elegido', tipo: 'periodo', precio: 1000, dias_duracion: 30, color: '#ff0059' });
    const sinColor = planes.crear({ nombre: 'Sin color', tipo: 'periodo', precio: 1000, dias_duracion: 30 });
    db.exec(sqlColorPlanes);
    check('la migracion 009 cambia el azul viejo de un plan por el amarillo',
          planes.obtenerPorId(azulViejo).color === '#ffe500', planes.obtenerPorId(azulViejo).color);
    check('y no toca un color elegido a mano',
          planes.obtenerPorId(aMano).color === '#ff0059', planes.obtenerPorId(aMano).color);
    check('ni le inventa color a un plan que no tenia',
          planes.obtenerPorId(sinColor).color === null, String(planes.obtenerPorId(sinColor).color));

    // ---- Y la 010: que no queden todos del mismo amarillo -----------------
    const sqlRepartoColores = fs.readFileSync(
      path.join(__dirname, '..', 'electron', 'db', 'migrations', '010_colores_planes_distintos.sql'), 'utf-8');
    // Con el espacio detras a proposito: asi se llama en la base de Andrey, y
    // comparando el nombre tal cual se quedaba fuera del reparto en silencio.
    //
    // Se mete por SQL directo y no con planes.crear() porque desde el 08-sep-2026
    // crear() recorta el nombre: por la puerta de la app ya no entra un "Dia ".
    // Lo que esto representa es una fila HEREDADA, de las que la importacion dejo
    // en la base antes de aquel cambio, y esas siguen ahi.
    const dia = planes.crear({ nombre: 'Dia', tipo: 'periodo', precio: 8000, dias_duracion: 1, color: '#3b5bdb' });
    db.prepare(`UPDATE planes SET nombre = 'Dia ' WHERE id = ?`).run(dia);
    check('el nombre sucio se queda tal cual cuando entra por SQL, no por crear()',
          planes.obtenerPorId(dia).nombre === 'Dia ', JSON.stringify(planes.obtenerPorId(dia).nombre));
    const paquete = planes.crear({ nombre: 'Paquete 10 clases', tipo: 'ticketera', precio: 90000, num_tickets: 10, color: '#3b5bdb' });
    const veinte = planes.crear({ nombre: '20 dias tickets', tipo: 'ticketera', precio: 150000, num_tickets: 20, color: '#3b5bdb' });
    const diaSinColor = planes.crear({ nombre: 'Dia', tipo: 'periodo', precio: 8000, dias_duracion: 1 });
    db.exec(sqlColorPlanes);
    db.exec(sqlRepartoColores);
    const colorDe = (id) => planes.obtenerPorId(id).color;
    check('el reparto encuentra el plan aunque su nombre traiga espacios',
          colorDe(dia) === '#ffa94d', String(colorDe(dia)));
    check('la migracion 010 le da un tono distinto a cada plan',
          new Set([colorDe(dia), colorDe(paquete), colorDe(veinte)]).size === 3,
          [colorDe(dia), colorDe(paquete), colorDe(veinte)].join(' '));
    check('y ninguno se queda con el azul viejo',
          [colorDe(dia), colorDe(paquete), colorDe(veinte)].every(c => c !== '#3b5bdb'));
    check('un plan del mismo nombre pero sin color se queda sin color',
          colorDe(diaSinColor) === null, String(colorDe(diaSinColor)));
    check('y el color elegido a mano sigue intacto tras las dos migraciones',
          planes.obtenerPorId(aMano).color === '#ff0059');

    // ---- Fase 2: el catalogo con lo que cuelga de cada plan ---------------
    // Renombrar o desactivar un plan a ciegas es lo que da miedo. listarTodos()
    // ahora dice cuanta gente lo esta usando HOY, cuanta lo uso alguna vez, y
    // cuales son el mismo plan escrito de otra forma.
    check('crear() recorta el nombre: por la app ya no entra un "Dia "',
          planes.obtenerPorId(
            planes.crear({ nombre: '  Trimestral  ', tipo: 'periodo', precio: 180000, dias_duracion: 90 })
          ).nombre === 'Trimestral');

    const conUso = planes.listarTodos();
    const porNombre = (n) => conUso.find(p => p.nombre === n);

    // 'Mensual' es el plan del principio de la suite: por el han pasado varias
    // membresias, unas vivas y otras vencidas a proposito.
    const mensualFila = conUso.find(p => p.id === mensual);
    check('cada plan viene con su historico de membresias',
          mensualFila.membresiasHistorico > 0, 'historico=' + mensualFila.membresiasHistorico);
    // La distincion que da todo el valor: "en uso" no es "vendidas alguna vez".
    // Un plan por el que pasaron dos personas y las dos ya vencieron se puede
    // desactivar tranquilamente; uno con gente dentro, no. Se prueba con un plan
    // recien hecho para que no dependa del estado en que dejo la suite a los
    // demas.
    const viejo = planes.crear({ nombre: 'Promo agotada', tipo: 'periodo', precio: 5000, dias_duracion: 1 });
    const carlos = clientes.crear({ documento: '901', nombre: 'Carlos', telefono: '302' });
    const dina = clientes.crear({ documento: '902', nombre: 'Dina', telefono: '303' });
    for (const quien of [carlos, dina]) {
      const id = membresias.vender({ clienteId: quien, planId: viejo, usuarioId, fInicio: haceDias(30) });
      membresias.registrarPago({ membresiaId: id, monto: 5000, metodo: 'Efectivo', usuarioId });
    }
    const filaVieja = planes.listarTodos().find(p => p.id === viejo);
    check('un plan que vendio dos veces y cuyas dos membresias vencieron sale 0 en uso',
          filaVieja.membresiasEnUso === 0 && filaVieja.membresiasHistorico === 2,
          filaVieja.membresiasEnUso + ' en uso / ' + filaVieja.membresiasHistorico + ' vendidas');

    // Y en cuanto una de las dos vuelve a estar vigente, el numero sube.
    const suya = db.prepare(`SELECT id FROM membresias WHERE plan_id = ? LIMIT 1`).get(viejo).id;
    db.prepare(`UPDATE membresias SET f_fin = ? WHERE id = ?`).run(enDias(10), suya);
    check('y en cuanto una vuelve a estar vigente, "en uso" pasa a 1',
          planes.listarTodos().find(p => p.id === viejo).membresiasEnUso === 1,
          'enUso=' + planes.listarTodos().find(p => p.id === viejo).membresiasEnUso);
    check('y con la fecha de la ultima que se vendio',
          /^\d{4}-\d{2}-\d{2}$/.test(mensualFila.ultimaVenta || ''), String(mensualFila.ultimaVenta));

    check('un plan que no ha vendido nunca sale en cero, no sin dato',
          porNombre('Trimestral').membresiasHistorico === 0 &&
          porNombre('Trimestral').membresiasEnUso === 0 &&
          porNombre('Trimestral').ultimaVenta === null);

    // Los dos avisos que hacen falta para limpiar el catalogo.
    check('senala el nombre con espacios sueltos, que en pantalla no se ven',
          porNombre('Dia ').nombreConEspacios === true &&
          porNombre('Dia').nombreConEspacios === false);
    check('y agrupa los que son el mismo plan escrito de otra forma',
          porNombre('Dia ').gemelos.includes(porNombre('Dia').id) &&
          porNombre('Dia').gemelos.includes(porNombre('Dia ').id),
          JSON.stringify([porNombre('Dia ').gemelos, porNombre('Dia').gemelos]));
    check('un plan con nombre unico no tiene gemelos',
          porNombre('Trimestral').gemelos.length === 0 &&
          conUso.find(p => p.id === mensual).gemelos.length === 0);

    // Las tildes tambien: "Dia" y "Día" son el mismo plan para quien lo lee, y
    // la importacion del Excel nuevo metio la version con tilde al lado de la
    // que ya estaba sin ella.
    const conTilde = planes.crear({ nombre: 'Día', tipo: 'periodo', precio: 8000, dias_duracion: 1 });
    const trasTilde = planes.listarTodos();
    check('"Día" con tilde se agrupa con los "Dia" que ya estaban',
          trasTilde.find(p => p.id === conTilde).gemelos.length === 2,
          'gemelos=' + trasTilde.find(p => p.id === conTilde).gemelos.length);

    // Desactivar no toca lo vendido: es lo que hace que limpiar el catalogo sea
    // seguro, y por eso se comprueba aqui y no de palabra.
    const antesDeDesactivar = trasTilde.find(p => p.id === mensual).membresiasHistorico;
    planes.desactivar(mensual);
    const trasDesactivar = planes.listarTodos().find(p => p.id === mensual);
    check('desactivar un plan no borra ni una de sus membresias',
          trasDesactivar.membresiasHistorico === antesDeDesactivar,
          antesDeDesactivar + ' -> ' + trasDesactivar.membresiasHistorico);
    check('el plan desactivado sigue saliendo en el catalogo, marcado como inactivo',
          trasDesactivar.activo === 0);
    planes.activar(mensual);

    // Renombrar tampoco: la membresia guarda copiado el nombre del dia en que se
    // vendio, y es lo que sale en el historial y en el Excel.
    const nombreEnMembresia = db.prepare(
      `SELECT plan_nombre FROM membresias WHERE plan_id = ? LIMIT 1`).get(mensual).plan_nombre;
    planes.editar(mensual, { nombre: '  Mensual renombrado  ', precio: 70000,
                             dias_duracion: 30, num_tickets: null, dias_vigencia: null, color: null });
    check('editar tambien recorta el nombre',
          planes.obtenerPorId(mensual).nombre === 'Mensual renombrado',
          JSON.stringify(planes.obtenerPorId(mensual).nombre));
    check('y renombrar el plan no cambia el nombre que guardo la membresia vendida',
          db.prepare(`SELECT plan_nombre FROM membresias WHERE plan_id = ? LIMIT 1`).get(mensual)
            .plan_nombre === nombreEnMembresia, nombreEnMembresia);

    // -------------------------------------------------------------------
    // Anadir y quitar tiquetes de una ticketera ya vendida. La verdad sigue
    // siendo tickets_totales; lo gastado no se toca desde aqui.
    // -------------------------------------------------------------------
    const tk = planes.crear({ nombre: 'Tiquetera 1 mes / 15 tiquetes', tipo: 'ticketera',
                              precio: 65000, num_tickets: 15, dias_vigencia: 30 });
    const cliTk = clientes.crear({ documento: '7000001111', nombre: 'Tita Tiquetes', telefono: '300' });
    const memTk = membresias.vender({ clienteId: cliTk, planId: tk, usuarioId });

    const inicial = membresias.estadoTickets(memTk);
    check('la ticketera nace con los 15 tiquetes del plan y ninguno usado',
          inicial.totales === 15 && inicial.usados === 0 && inicial.disponibles === 15,
          JSON.stringify(inicial));

    const masCinco = membresias.ajustarTickets({ membresiaId: memTk, delta: 5, motivo: 'cortesia', usuarioId });
    check('anadir 5 deja 20 disponibles',
          masCinco.ok === true && masCinco.totales === 20 && masCinco.disponibles === 20,
          JSON.stringify(masCinco));

    const menosTres = membresias.ajustarTickets({ membresiaId: memTk, delta: -3, usuarioId });
    check('quitar 3 deja 17', menosTres.ok === true && menosTres.disponibles === 17);

    // El freno que importa: quitar mas de los que quedan es un error de dedo.
    const pasado = membresias.ajustarTickets({ membresiaId: memTk, delta: -50, usuarioId });
    check('no se puede dejar el saldo en negativo',
          pasado.ok === false && pasado.motivo === 'quedaria_en_negativo' &&
          pasado.disponiblesAhora === 17, JSON.stringify(pasado));
    check('y el rechazo no cambio nada', membresias.estadoTickets(memTk).totales === 17);

    check('un ajuste de 0 no hace nada',
          membresias.ajustarTickets({ membresiaId: memTk, delta: 0, usuarioId }).motivo === 'cantidad_invalida');

    // Gastar un tiquete es cosa de las asistencias, no de este ajuste.
    db.prepare(`UPDATE membresias SET tickets_usados = 4 WHERE id = ?`).run(memTk);
    const conUsados = membresias.estadoTickets(memTk);
    check('los disponibles descuentan lo ya usado',
          conUsados.disponibles === 13 && conUsados.usados === 4, JSON.stringify(conUsados));
    const alRas = membresias.ajustarTickets({ membresiaId: memTk, delta: -13, usuarioId });
    check('se puede bajar justo hasta cero, no mas', alRas.ok === true && alRas.disponibles === 0);
    check('pero ni uno mas',
          membresias.ajustarTickets({ membresiaId: memTk, delta: -1, usuarioId }).ok === false);

    // Una membresia de periodo no tiene tiquetes que ajustar.
    const dePeriodo = membresias.vender({ clienteId: ana, planId: mensual, usuarioId, fInicio: '2027-01-01' });
    check('una membresia de periodo rechaza el ajuste',
          membresias.ajustarTickets({ membresiaId: dePeriodo, delta: 5, usuarioId }).motivo === 'no_es_ticketera');
    check('y estadoTickets no devuelve nada para ella',
          membresias.estadoTickets(dePeriodo) === null);

    // Cada ajuste queda escrito, que es lo que permite revisar un saldo raro.
    const historial = membresias.estadoTickets(memTk).ajustes;
    check('cada ajuste queda en auditoria con su cantidad',
          historial.length === 3 && historial[0].delta === -13,
          'ajustes=' + historial.length);
    check('y con el motivo cuando se escribio',
          historial.some(a => a.motivo === 'cortesia'));

    // ------------------------------------ marcar dos veces no gasta tiquetes
    //
    // Fallo real, medido el 12-sep: el tiquete se descontaba ANTES de insertar la
    // asistencia, y el "una por dia" lo decidia el indice unico al insertar. Cada
    // marca repetida el mismo dia decia "ya registraste tu asistencia" y se
    // llevaba un tiquete: 4 marcas, 4 tiquetes, 1 asistencia. Con la puerta,
    // volver a marcar (salir al carro y volver) pasa a ser lo normal.
    const planRep = planes.crear({ nombre: 'Tiquetera repetida', tipo: 'ticketera',
                                   precio: 65000, num_tickets: 15, dias_vigencia: 30 });
    const repite = clientes.crear({ documento: '5550001111', nombre: 'Repite Marca', telefono: '320' });
    const mRep = membresias.vender({ clienteId: repite, planId: planRep, usuarioId });
    membresias.registrarPago({ membresiaId: mRep, monto: 65000, metodo: 'Efectivo', usuarioId });
    const usadosRep = () => db.prepare('SELECT tickets_usados u FROM membresias WHERE id = ?').get(mRep).u;
    const asisRep = () => db.prepare('SELECT COUNT(*) n FROM asistencias WHERE cliente_id = ?').get(repite).n;

    const primera = asistencias.registrar({ clienteId: repite, metodo: 'pin', registradoPor: null });
    check('la primera marca del dia gasta un tiquete', primera.ok === true && usadosRep() === 1);
    for (let i = 0; i < 3; i++) {
      asistencias.registrar({ clienteId: repite, metodo: 'pin', registradoPor: null });
    }
    check('tres marcas mas el mismo dia NO gastan tiquetes',
          usadosRep() === 1 && asisRep() === 1, 'usados=' + usadosRep() + ' asistencias=' + asisRep());
    check('y contestan ya_registrado_hoy',
          asistencias.registrar({ clienteId: repite, metodo: 'huella', registradoPor: null }).motivo === 'ya_registrado_hoy');

    // La carrera: dos marcas del mismo cliente en el mismo instante (PIN y huella
    // a la vez). La comprobacion previa no ve nada todavia, y la asistencia en
    // conflicto aparece entre el UPDATE del tiquete y el INSERT. Se simula con un
    // trigger que la mete justo ahi: si el tiquete y la asistencia no van en una
    // sola transaccion, el tiquete queda gastado sin asistencia.
    const carrera = clientes.crear({ documento: '5550002222', nombre: 'Marca Doble', telefono: '321' });
    const mCar = membresias.vender({ clienteId: carrera, planId: planRep, usuarioId });
    membresias.registrarPago({ membresiaId: mCar, monto: 65000, metodo: 'Efectivo', usuarioId });
    db.exec(`CREATE TEMP TRIGGER simular_carrera AFTER UPDATE OF tickets_usados ON membresias
             WHEN NEW.id = ${mCar}
             BEGIN
               INSERT INTO asistencias (cliente_id, fecha_hora, fecha, metodo, membresia_id, ticket_usado, registrado_por)
               VALUES (${carrera}, '${hoy}T00:00:00.000Z', '${hoy}', 'huella', ${mCar}, 1, NULL);
             END;`);
    const enCarrera = asistencias.registrar({ clienteId: carrera, metodo: 'pin', registradoPor: null });
    db.exec('DROP TRIGGER simular_carrera');
    const usadosCar = db.prepare('SELECT tickets_usados u FROM membresias WHERE id = ?').get(mCar).u;
    const asisCar = db.prepare('SELECT COUNT(*) n FROM asistencias WHERE cliente_id = ?').get(carrera).n;
    check('en la carrera contesta ya_registrado_hoy', enCarrera.ok === false && enCarrera.motivo === 'ya_registrado_hoy',
          JSON.stringify(enCarrera));
    check('y deshace el tiquete: la transaccion no deja uno gastado sin asistencia',
          usadosCar === 0 && asisCar === 0, 'usados=' + usadosCar + ' asistencias=' + asisCar);

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
