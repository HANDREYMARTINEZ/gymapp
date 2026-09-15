const { format } = require('date-fns');
const { getDb } = require('../connection');
const { estadoMembresia, elegirMembresiaGobernante, puedeEntrenar, estaFiadaAlDia } = require('../../services/membresias-logica');
const ventasRepo = require('./ventas');

// Los tres bloques de la pantalla de Clientes: la lista buscable de la izquierda,
// los que deben dinero y los que hoy no pueden entrenar.
//
// El estado no se decide en SQL. Depende de pausas, saldo y fechas a la vez, y
// esa mezcla ya la resuelve estadoMembresia(), que es la misma que usan el
// kiosco, la ficha y el dashboard. Escribir aqui un CASE WHEN equivalente seria
// tener dos definiciones de "vencida" que dejan de coincidir a la primera.
//
// Lo que si se evita es preguntar por cada cliente uno a uno: con cincuenta
// clientes y su historial, listarPorCliente() en bucle son cientos de consultas
// para pintar una pantalla que se abre todo el dia. Se traen las tres tablas de
// una vez y se cruzan en memoria.

function hoyLocal() {
  return format(new Date(), 'yyyy-MM-dd');
}

function cargarEstados() {
  const db = getDb();
  const hoy = hoyLocal();

  const membresias = db.prepare(`
    SELECT m.* FROM membresias m
    JOIN clientes c ON c.id = m.cliente_id
    WHERE c.activo = 1
  `).all();

  const pausadas = new Set(
    db.prepare(`SELECT DISTINCT membresia_id FROM membresia_pausas WHERE f_fin IS NULL`)
      .all().map(r => r.membresia_id)
  );

  const pagado = new Map(
    db.prepare(`
      SELECT membresia_id, COALESCE(SUM(monto), 0) AS total
      FROM pagos WHERE anulada = 0 GROUP BY membresia_id
    `).all().map(r => [r.membresia_id, r.total])
  );

  const porCliente = new Map();
  for (const m of membresias) {
    const saldoPendiente = m.precio_pagado - (pagado.get(m.id) || 0);
    const conEstado = {
      ...m,
      saldoPendiente,
      estado: estadoMembresia(m, hoy, pausadas.has(m.id), saldoPendiente),
    };
    if (!porCliente.has(m.cliente_id)) porCliente.set(m.cliente_id, []);
    porCliente.get(m.cliente_id).push(conEstado);
  }
  return porCliente;
}

function resumirCliente(cliente, susMembresias) {
  const gobernante = elegirMembresiaGobernante(susMembresias || []);
  const estado = gobernante ? gobernante.estado : 'sin_membresia';
  return {
    id: cliente.id,
    nombre: cliente.nombre,
    documento: cliente.documento,
    documentoProvisional: cliente.documento_provisional === 1,
    telefono: cliente.telefono,
    estado,
    puedeEntrenar: puedeEntrenar(estado),
    membresiaId: gobernante ? gobernante.id : null,
    // Lo que debe en total, no solo en la membresia que manda: si tiene dos a
    // medio pagar, el mostrador quiere ver la suma.
    saldoPendiente: (susMembresias || [])
      .filter(m => !m.anulada)
      .reduce((suma, m) => suma + Math.max(0, m.saldoPendiente), 0),
  };
}

// Lista de la izquierda. Con el buscador vacio devuelve los primeros por nombre
// en vez de nada: una pantalla en blanco al entrar no dice que hay que escribir.
function buscarConEstado(texto = '') {
  const like = `%${texto || ''}%`;
  const clientes = getDb().prepare(`
    SELECT id, documento, nombre, telefono, documento_provisional
    FROM clientes
    WHERE activo = 1 AND (nombre LIKE ? OR IFNULL(documento, '') LIKE ?)
    ORDER BY nombre
    LIMIT 50
  `).all(like, like);

  const estados = cargarEstados();
  return clientes.map(c => resumirCliente(c, estados.get(c.id)));
}

// Bloques de la derecha. No dependen de lo que se escriba en el buscador, asi
// que se piden por separado y no se recalculan con cada tecla.
function panelLateral() {
  const estados = cargarEstados();
  const clientes = getDb()
    .prepare(`SELECT id, documento, nombre, telefono, documento_provisional FROM clientes WHERE activo = 1`)
    .all();

  const resumidos = clientes.map(c => resumirCliente(c, estados.get(c.id)));
  const hoy = hoyLocal();

  // Las ventas fiadas de la tienda van a la misma lista: la deuda de un cliente es
  // una sola (decision del 15-sep-2026). Se traen todas de una vez, como el resto.
  const fiadas = new Map();
  for (const v of ventasRepo.fiadasPendientes()) {
    if (!fiadas.has(v.cliente_id)) fiadas.set(v.cliente_id, []);
    fiadas.get(v.cliente_id).push({
      id: v.id, detalle: v.detalle, saldo: v.saldo, fecha: v.fecha,
      fiadoHasta: v.fiado_hasta || null,
      vencido: !!v.fiado_hasta && hoy > v.fiado_hasta,
    });
  }

  const conSaldo = resumidos
    .map(c => {
      const ventasFiadas = fiadas.get(c.id) || [];
      // La membresia concreta que hay que pagar, para que el boton de la tarjeta
      // sepa a cual abonar sin que el mostrador tenga que entrar a la ficha.
      const membresiasConSaldo = (estados.get(c.id) || [])
        .filter(m => !m.anulada && m.saldoPendiente > 0)
        .map(m => ({ id: m.id, planNombre: m.plan_nombre, saldo: m.saldoPendiente, fInicio: m.f_inicio,
                     fiadoHasta: m.fiado_hasta || null, vencido: !estaFiadaAlDia(m, hoy) }));
      const deVentas = ventasFiadas.reduce((s, v) => s + v.saldo, 0);
      return {
        ...c,
        saldoPendiente: c.saldoPendiente + deVentas,
        membresiasConSaldo,
        ventasFiadas,
        vencido: membresiasConSaldo.some(m => m.vencido) || ventasFiadas.some(v => v.vencido),
      };
    })
    .filter(c => c.saldoPendiente > 0)
    .sort((a, b) => b.saldoPendiente - a.saldoPendiente);

  // "Vencidos o sin tickets", literal: los que ya tuvieron algo y se les acabo.
  // Quien no ha comprado nunca no entra aqui, o la lista serian todos los
  // registrados de la historia del gimnasio.
  const noPuedenEntrenar = resumidos
    .filter(c => c.estado === 'vencida' || c.estado === 'agotada')
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return { conSaldo, noPuedenEntrenar };
}

// cargarEstados sale fuera para los recordatorios de vencimiento: necesitan la
// misma definicion de 'vencida' que esta pantalla, no una copia parecida.
module.exports = { buscarConEstado, panelLateral, cargarEstados };
