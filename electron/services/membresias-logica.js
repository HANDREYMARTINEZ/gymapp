const { differenceInCalendarDays, addDays, parseISO, format } = require('date-fns');

function diasEntre(fechaHoy, fechaFin) {
  return differenceInCalendarDays(parseISO(fechaFin), parseISO(fechaHoy));
}

function estadoMembresia(m, hoy, pausaActiva, saldoPendiente, diasAviso = 5) {
  if (m.anulada) return 'anulada';
  if (pausaActiva) return 'pausada';
  if (saldoPendiente > 0) return 'saldo_pendiente';

  if (m.plan_tipo === 'ticketera') {
    const quedan = m.tickets_totales - m.tickets_usados;
    if (quedan <= 0) return 'agotada';
    if (m.f_fin && hoy > m.f_fin) return 'vencida';
    return quedan <= 2 ? 'por_vencer' : 'activa';
  }

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

module.exports = { diasEntre, estadoMembresia, calcularFechaInicioRenovacion, elegirTicketeraParaConsumo };