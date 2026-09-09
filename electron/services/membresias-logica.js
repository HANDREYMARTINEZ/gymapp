const { differenceInCalendarDays, addDays, parseISO, format } = require('date-fns');

function diasEntre(fechaHoy, fechaFin) {
  return differenceInCalendarDays(parseISO(fechaFin), parseISO(fechaHoy));
}

function estadoMembresia(m, hoy, pausaActiva, saldoPendiente, diasAviso = 5) {
  if (m.anulada) return 'anulada';
  if (pausaActiva) return 'pausada';
  if (saldoPendiente > 0) return 'saldo_pendiente';

  // Desde que la fecha de inicio se elige a mano se pueden vender membresias que
  // empiezan mas adelante. Sin esto, una que arranca el mes que viene contaria
  // como activa hoy y el kiosco dejaria entrar al cliente antes de tiempo.
  if (m.f_inicio > hoy) return 'programada';

  if (m.plan_tipo === 'ticketera') {
    const quedan = m.tickets_totales - m.tickets_usados;
    if (quedan <= 0) return 'agotada';
    if (m.f_fin && hoy > m.f_fin) return 'vencida';
    return quedan <= 2 ? 'por_vencer' : 'activa';
  }

  // Una membresia de periodo sin fecha de fin no se puede vencer: no hay contra
  // que comparar. Pasa con filas del Excel que no traen "Fecha fin" y cuyo plan
  // tampoco dice cuantos dias dura. Se trata como activa, igual que ya hace la
  // rama de ticketera unas lineas mas arriba, en vez de reventar al restar
  // fechas contra null.
  if (!m.f_fin) return 'activa';

  if (hoy > m.f_fin) return 'vencida';
  const dias = diasEntre(hoy, m.f_fin);
  return dias <= diasAviso ? 'por_vencer' : 'activa';
}

function calcularFechaInicioRenovacion(membresiaAnterior, hoy) {
  if (!membresiaAnterior) return hoy;
  const siguevigente = membresiaAnterior.f_fin && membresiaAnterior.f_fin >= hoy && !membresiaAnterior.anulada;
  if (siguevigente) {
    return format(addDays(parseISO(membresiaAnterior.f_fin), 1), 'yyyy-MM-dd');
  }
  return hoy;
}

// De todas las membresias de un cliente, cual manda. Vive aqui y no en el repo
// de asistencias porque el listado de clientes tiene que contestar "puede
// entrenar" con el mismo criterio con el que el kiosco abre o no la puerta. Dos
// definiciones de lo mismo acaban discrepando.
const ESTADOS_QUE_DEJAN_ENTRAR = ['activa', 'por_vencer'];
const ORDEN_BLOQUEO = ['pausada', 'saldo_pendiente', 'programada', 'vencida', 'agotada', 'anulada'];

function elegirMembresiaGobernante(membresias) {
  const permiten = membresias.filter(m => ESTADOS_QUE_DEJAN_ENTRAR.includes(m.estado));
  if (permiten.length > 0) {
    const periodo = permiten.find(m => m.plan_tipo === 'periodo');
    return periodo || permiten[0];
  }
  for (const estado of ORDEN_BLOQUEO) {
    const m = membresias.find(x => x.estado === estado);
    if (m) return m;
  }
  return null;
}

function puedeEntrenar(estado) {
  return ESTADOS_QUE_DEJAN_ENTRAR.includes(estado);
}

function elegirTicketeraParaConsumo(ticketerasActivas) {
  const conTickets = ticketerasActivas.filter(t => (t.tickets_totales - t.tickets_usados) > 0);
  if (conTickets.length === 0) return null;
  return conTickets.sort((a, b) => {
    if (a.f_fin && b.f_fin) return a.f_fin.localeCompare(b.f_fin);
    if (a.f_fin) return -1;
    if (b.f_fin) return 1;
    return a.creada_en.localeCompare(b.creada_en);
  })[0];
}

module.exports = {
  diasEntre, estadoMembresia, calcularFechaInicioRenovacion, elegirTicketeraParaConsumo,
  elegirMembresiaGobernante, puedeEntrenar, ESTADOS_QUE_DEJAN_ENTRAR,
};