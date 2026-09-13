const { getDb } = require('../connection');
const { format } = require('date-fns');
const { elegirTicketeraParaConsumo, elegirMembresiaGobernante, puedeEntrenar, puedeReingresar } = require('../../services/membresias-logica');
const { listarPorCliente } = require('./membresias');

function hoyISO() {
  return format(new Date(), 'yyyy-MM-dd');
}

function registrar({ clienteId, metodo, registradoPor }) {
  const hoy = hoyISO();

  // Lo primero, antes de tocar ningun tiquete. Antes esto lo decidia el indice
  // unico al INSERTAR, que llega DESPUES del UPDATE que gasta el tiquete: cada
  // vez que alguien de tiquetera volvia a marcar el mismo dia, la pantalla le
  // decia "ya registraste tu asistencia" y por detras le quitaba un tiquete.
  // Medido el 12-sep: 4 marcas, 4 tiquetes gastados, 1 asistencia. No habia
  // pasado aun con clientes reales porque nadie repetia; con la puerta, repetir
  // es lo normal (salir al carro y volver).
  const yaVinoHoy = getDb().prepare(
    'SELECT 1 FROM asistencias WHERE cliente_id = ? AND fecha = ?'
  ).get(clienteId, hoy);
  if (yaVinoHoy) return { ok: false, motivo: 'ya_registrado_hoy' };

  const membresias = listarPorCliente(clienteId);
  const gobernante = elegirMembresiaGobernante(membresias);

  if (!gobernante) {
    return { ok: false, motivo: 'sin_membresia' };
  }
  if (!puedeEntrenar(gobernante.estado)) {
    return { ok: false, motivo: gobernante.estado };
  }

  let ticketUsado = 0;
  let membresiaIdUsada = gobernante.id;
  let ticketeraElegida = null;

  if (gobernante.plan_tipo === 'ticketera') {
    const ticketeras = membresias.filter(m =>
      m.plan_tipo === 'ticketera' && puedeEntrenar(m.estado)
    );
    ticketeraElegida = elegirTicketeraParaConsumo(ticketeras);
    if (!ticketeraElegida) {
      return { ok: false, motivo: 'agotada' };
    }
    ticketUsado = 1;
    membresiaIdUsada = ticketeraElegida.id;
  }

  // El tiquete y la asistencia van en UNA transaccion: o se guardan los dos o
  // ninguno. La comprobacion de arriba cubre el caso normal; esto cubre el raro
  // (dos marcas del mismo cliente en el mismo instante, PIN y huella a la vez),
  // en el que el indice unico hace fallar el INSERT y el UPDATE se deshace.
  const guardar = getDb().transaction(() => {
    if (ticketeraElegida) {
      getDb().prepare(`UPDATE membresias SET tickets_usados = tickets_usados + 1 WHERE id = ?`).run(ticketeraElegida.id);
    }
    getDb().prepare(`
      INSERT INTO asistencias (cliente_id, fecha_hora, fecha, metodo, membresia_id, ticket_usado, registrado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(clienteId, new Date().toISOString(), hoy, metodo, membresiaIdUsada, ticketUsado, registradoPor || null);
  });

  try {
    guardar();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return { ok: false, motivo: 'ya_registrado_hoy' };
    }
    throw e;
  }

  return { ok: true, membresiaId: membresiaIdUsada, ticketUsado: !!ticketUsado, estado: gobernante.estado };
}

// El cliente ya marco hoy: puede volver a entrar? No escribe nada -- ni otra
// asistencia ni otro tiquete --, solo contesta. Ver puedeReingresar().
function evaluarReingreso(clienteId) {
  const deHoy = getDb().prepare(
    'SELECT membresia_id FROM asistencias WHERE cliente_id = ? AND fecha = ?'
  ).get(clienteId, hoyISO());
  if (!deHoy) return { ok: false, motivo: 'sin_asistencia_hoy' };

  // Si la membresia de hoy ya no existe (la borraron desde recepcion), no hay con
  // que decidir: se queda el mensaje de siempre y no se abre.
  const usada = listarPorCliente(clienteId).find(m => m.id === deHoy.membresia_id);
  if (!usada) return { ok: false, motivo: 'ya_registrado_hoy' };

  if (!puedeReingresar(usada.estado)) return { ok: false, motivo: usada.estado };
  return { ok: true, membresiaId: usada.id, estado: usada.estado };
}

function listarDelDia(fecha) {
  return getDb().prepare(`
    SELECT a.*, c.nombre AS cliente_nombre
    FROM asistencias a JOIN clientes c ON c.id = a.cliente_id
    WHERE a.fecha = ?
    ORDER BY a.fecha_hora DESC
  `).all(fecha);
}

module.exports = { registrar, evaluarReingreso, listarDelDia };