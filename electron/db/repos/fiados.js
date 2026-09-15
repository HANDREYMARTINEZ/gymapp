const { format } = require('date-fns');
const { getDb } = require('../connection');
const membresias = require('./membresias');
const ventas = require('./ventas');
const { esMedioValido } = require('../../services/medios-pago');
const { estaFiadaAlDia } = require('../../services/membresias-logica');

// La cuenta de un cliente: todo lo que debe, junto. Decision de Andrey del
// 15-sep-2026 -- se fia en membresias y en la tienda, y todo cae en una sola
// cuenta.
//
// No hay tabla de "cuenta". Las deudas ya estan donde nacen: el saldo de una
// membresia es su precio menos sus pagos, y el de una venta fiada su total menos
// sus abonos. Una tabla con el total seria una segunda contabilidad que tarde o
// temprano discreparia de esas dos; aqui solo se juntan para mirarlas y cobrarlas.

function hoyLocal() {
  return format(new Date(), 'yyyy-MM-dd');
}

function localDe(iso) {
  return format(new Date(iso), 'yyyy-MM-dd');
}

function cuentaDeCliente(clienteId) {
  const hoy = hoyLocal();

  const deMembresias = membresias.listarPorCliente(clienteId)
    .filter(m => !m.anulada && m.saldoPendiente > 0)
    .map(m => ({
      tipo: 'membresia',
      id: m.id,
      concepto: m.plan_nombre,
      fecha: m.f_inicio,
      total: m.precio_pagado,
      saldo: m.saldoPendiente,
      fiadoHasta: m.fiado_hasta || null,
      // Sin fecha de fiado, una membresia con saldo bloquea desde el primer dia:
      // para el mostrador eso ya es "hay que cobrar".
      vencido: !estaFiadaAlDia(m, hoy),
    }));

  const deVentas = ventas.fiadasPendientes(clienteId).map(v => ({
    tipo: 'venta',
    id: v.id,
    concepto: 'Venta #' + v.id + (v.detalle ? ' (' + v.detalle + ')' : ''),
    fecha: localDe(v.fecha),
    total: v.total,
    saldo: v.saldo,
    fiadoHasta: v.fiado_hasta || null,
    vencido: !!v.fiado_hasta && hoy > v.fiado_hasta,
  }));

  // Lo mas viejo primero: es el orden en que se cobra.
  const items = [...deMembresias, ...deVentas]
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.tipo === b.tipo ? a.id - b.id : (a.tipo === 'membresia' ? -1 : 1)));

  return {
    clienteId,
    total: items.reduce((s, i) => s + i.saldo, 0),
    vencido: items.some(i => i.vencido),
    items,
  };
}

// Cobrar a cuenta: el monto se reparte de la deuda mas vieja a la mas nueva. Cada
// trozo es un pago de membresia o un abono de venta de verdad, con su movimiento
// de caja si fue en efectivo, asi que la Caja, los dashboards y la ficha lo ven
// igual que si se hubiera cobrado uno por uno.
//
// Todo o nada: si un trozo falla (por ejemplo, efectivo sin caja abierta), no
// queda ninguno aplicado.
class CobroRechazado extends Error {
  constructor(motivo, extra) { super('cobro_rechazado:' + motivo); this.motivo = motivo; this.extra = extra || {}; }
}

function cobrar({ clienteId, monto, metodo, usuarioId, nota } = {}) {
  const n = parseInt(monto, 10);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, motivo: 'monto_invalido' };
  if (!esMedioValido(metodo)) return { ok: false, motivo: 'medio_pago_invalido' };

  const db = getDb();
  try {
    return db.transaction(() => {
      const cuenta = cuentaDeCliente(clienteId);
      if (cuenta.total <= 0) throw new CobroRechazado('sin_deuda');
      if (n > cuenta.total) throw new CobroRechazado('mas_que_la_deuda', { deuda: cuenta.total });

      let queda = n;
      const aplicado = [];
      for (const item of cuenta.items) {
        if (queda <= 0) break;
        const parte = Math.min(queda, item.saldo);

        if (item.tipo === 'membresia') {
          const r = membresias.registrarPago({ membresiaId: item.id, monto: parte, metodo, usuarioId,
                                               nota: nota || 'Cobro de fiado' });
          if (!r.ok) throw new CobroRechazado(r.motivo);
        } else {
          try {
            ventas.abonarSinAtrapar({ ventaId: item.id, monto: parte, metodo, usuarioId, nota });
          } catch (e) {
            if (e instanceof ventas.AbonoRechazado) throw new CobroRechazado(e.motivo);
            throw e;
          }
        }

        aplicado.push({ tipo: item.tipo, id: item.id, concepto: item.concepto, monto: parte });
        queda -= parte;
      }

      return { ok: true, cobrado: n, aplicado, debeTodavia: cuenta.total - n };
    })();
  } catch (e) {
    if (e instanceof CobroRechazado) return { ok: false, motivo: e.motivo, ...e.extra };
    throw e;
  }
}

module.exports = { cuentaDeCliente, cobrar };
