const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Fiados (15-sep-2026): membresias fiadas hasta una fecha, ventas fiadas de la
// tienda, y la cuenta del cliente que junta las dos y se cobra de lo mas viejo a
// lo mas nuevo. Lo que se vigila es lo que duele si falla: que un fiado no meta
// dinero falso al cajon ni a los ingresos, que el kiosco deje entrar hasta la
// fecha y no despues, y que un cobro a medias no quede aplicado a medias.

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-fiados-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-fiados-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const { format, addDays } = require('date-fns');
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();
    const productos = require('../electron/db/repos/productos');
    const caja = require('../electron/db/repos/caja');
    const ventas = require('../electron/db/repos/ventas');
    const membresias = require('../electron/db/repos/membresias');
    const clientes = require('../electron/db/repos/clientes');
    const planes = require('../electron/db/repos/planes');
    const asistencias = require('../electron/db/repos/asistencias');
    const fiados = require('../electron/db/repos/fiados');
    const panel = require('../electron/db/repos/panel-clientes');
    const dash = require('../electron/db/repos/dashboard');

    const dia = (n) => format(addDays(new Date(), n), 'yyyy-MM-dd');
    const hoy = dia(0);

    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Cajero', 'cajero', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;

    const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 70000, dias_duracion: 30 });
    const ana = clientes.crear({ documento: '9901', nombre: 'Ana Fiada' });
    const beto = clientes.crear({ documento: '9902', nombre: 'Beto Vencido' });
    const cami = clientes.crear({ documento: '9903', nombre: 'Camila Tienda' });
    const dario = clientes.crear({ documento: '9904', nombre: 'Dario Baja' });

    const agua = productos.crear({ nombre: 'Agua', p_venta: 3000, p_costo: 1000, stock: 50 }).id;
    const crema = productos.crear({ nombre: 'Crema ajena', p_venta: 20000, p_costo: 0, stock: 10, fuera_de_caja: true }).id;

    const estadoDe = (membresiaId) => membresias.listarPorCliente(
      db.prepare('SELECT cliente_id FROM membresias WHERE id = ?').get(membresiaId).cliente_id
    ).find(m => m.id === membresiaId).estado;
    const movimientos = () => db.prepare('SELECT COUNT(*) AS n FROM caja_movimientos').get().n;

    // ============================================================ membresias
    const mAna = membresias.vender({ clienteId: ana, planId: mensual, usuarioId, fInicio: dia(-5) });
    check('sin pagar ni fiar, la membresia bloquea por saldo', estadoDe(mAna) === 'saldo_pendiente', estadoDe(mAna));

    check('no se fia hasta una fecha pasada',
          membresias.fiar({ membresiaId: mAna, fiadoHasta: dia(-1), usuarioId }).motivo === 'fecha_pasada');
    check('ni con una fecha que no existe',
          membresias.fiar({ membresiaId: mAna, fiadoHasta: '2026-02-31', usuarioId }).motivo === 'fecha_invalida');
    check('ni sin fecha',
          membresias.fiar({ membresiaId: mAna, fiadoHasta: '', usuarioId }).motivo === 'fecha_invalida');

    const movAntesDeFiar = movimientos();
    const fiada = membresias.fiar({ membresiaId: mAna, fiadoHasta: dia(3), usuarioId });
    check('fiar hasta dentro de 3 dias funciona', fiada.ok && fiada.saldo === 70000, JSON.stringify(fiada));
    check('fiada al dia deja de bloquear', estadoDe(mAna) === 'activa', estadoDe(mAna));
    check('fiar no crea pagos', membresias.listarPagos(mAna).length === 0);
    check('fiar no toca la caja', movimientos() === movAntesDeFiar);
    check('el saldo sigue ahi', membresias.calcularSaldoPendiente(mAna) === 70000);
    check('fiar queda en auditoria',
          db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'membresia_fiada' AND entidad_id = ?`).get(mAna).n === 1);

    const entraAna = asistencias.registrar({ clienteId: ana, metodo: 'pin', registradoPor: null });
    check('el kiosco deja entrar a quien tiene la membresia fiada al dia', entraAna.ok, JSON.stringify(entraAna));

    // El ultimo dia de la fecha todavia entra; al dia siguiente, no.
    const mBeto = membresias.vender({ clienteId: beto, planId: mensual, usuarioId, fInicio: dia(-10) });
    membresias.fiar({ membresiaId: mBeto, fiadoHasta: hoy, usuarioId });
    check('el mismo dia de la fecha de pago todavia entra', estadoDe(mBeto) === 'activa', estadoDe(mBeto));
    db.prepare('UPDATE membresias SET fiado_hasta = ? WHERE id = ?').run(dia(-1), mBeto);
    check('pasada la fecha sin pagar, vuelve a bloquear', estadoDe(mBeto) === 'saldo_pendiente', estadoDe(mBeto));
    const entraBeto = asistencias.registrar({ clienteId: beto, metodo: 'pin', registradoPor: null });
    check('y el kiosco ya no lo deja entrar', !entraBeto.ok && entraBeto.motivo === 'saldo_pendiente',
          JSON.stringify(entraBeto));
    check('volver a fiar mueve la fecha y vuelve a dejar entrar',
          membresias.fiar({ membresiaId: mBeto, fiadoHasta: dia(2), usuarioId }).ok && estadoDe(mBeto) === 'activa');

    const pagoFiado = membresias.registrarPago({ membresiaId: mAna, monto: 70000, metodo: 'Fiado', usuarioId });
    check('no se puede "pagar" una membresia con Fiado', !pagoFiado.ok && pagoFiado.motivo === 'medio_pago_invalido',
          pagoFiado.motivo);
    check('ni con un medio inventado',
          membresias.registrarPago({ membresiaId: mAna, monto: 1000, metodo: 'Bitcoin', usuarioId }).motivo === 'medio_pago_invalido');
    check('y el saldo no bajo', membresias.calcularSaldoPendiente(mAna) === 70000);

    // ================================================================ tienda
    const stockAntes = productos.obtenerPorId(agua).stock;
    const sinCliente = ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Fiado', usuarioId });
    check('no se fia en la tienda sin cliente', !sinCliente.ok && sinCliente.motivo === 'fiado_sin_cliente');
    clientes.darDeBaja({ clienteId: dario, usuarioId, motivo: 'prueba' });
    check('ni a un cliente dado de baja',
          ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Fiado', usuarioId, clienteId: dario }).motivo === 'fiado_sin_cliente');
    check('ni hasta una fecha pasada',
          ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Fiado', usuarioId, clienteId: cami, fiadoHasta: dia(-1) }).motivo === 'fecha_pasada');
    check('los rechazos no mueven stock', productos.obtenerPorId(agua).stock === stockAntes);

    // Sin caja abierta: fiar no necesita cajon.
    check('no hay caja abierta', !caja.sesionAbierta());
    const vMixta = ventas.registrar({
      items: [{ productoId: agua, cantidad: 2 }, { productoId: crema, cantidad: 1 }],
      metodoPago: 'fiado', usuarioId, clienteId: cami, fiadoHasta: dia(7),
    });
    check('la venta fiada pasa sin caja abierta', vMixta.ok && vMixta.total === 26000, JSON.stringify(vMixta));
    check('saca el stock', productos.obtenerPorId(agua).stock === stockAntes - 2);
    check('se guarda con el medio escrito siempre igual',
          db.prepare('SELECT metodo_pago, fiado_hasta FROM ventas WHERE id = ?').get(vMixta.ventaId).metodo_pago === 'Fiado');
    check('no crea movimientos de caja', movimientos() === movAntesDeFiar);

    const ing1 = dash.ingresosDelDia(hoy);
    check('lo fiado NO cuenta como ingreso del dia', ing1.ventas.total === 0 && ing1.total === 0, JSON.stringify(ing1.ventas));
    check('ni su parte de fuera de caja', ing1.fueraDeCaja.total === 0, 'fuera=' + ing1.fueraDeCaja.total);
    check('pero se informa aparte', ing1.fiado.total === 26000 && ing1.fiado.ventas === 1, JSON.stringify(ing1.fiado));

    check('no se abona con Fiado',
          ventas.abonar({ ventaId: vMixta.ventaId, monto: 1000, metodo: 'Fiado', usuarioId }).motivo === 'medio_pago_invalido');
    const demas = ventas.abonar({ ventaId: vMixta.ventaId, monto: 26001, metodo: 'QR', usuarioId });
    check('no se abona mas de lo que se debe', demas.motivo === 'mas_que_el_saldo' && demas.saldo === 26000, JSON.stringify(demas));
    const efSinCaja = ventas.abonar({ ventaId: vMixta.ventaId, monto: 10000, metodo: 'Efectivo', usuarioId });
    check('abonar en efectivo sin caja se bloquea', efSinCaja.motivo === 'sin_caja_abierta', efSinCaja.motivo);
    check('y no deja el abono guardado', ventas.listarAbonos(vMixta.ventaId).length === 0);
    const ventaNormal = ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'QR', usuarioId });
    check('una venta que no es fiada no se abona',
          ventas.abonar({ ventaId: ventaNormal.ventaId, monto: 1000, metodo: 'QR', usuarioId }).motivo === 'no_es_fiado');

    caja.abrir({ usuarioId, baseInicial: 50000 });
    const sesion = caja.sesionAbierta().id;
    const esperado0 = caja.resumen(sesion).esperado;

    // Del ticket de 26.000, 6.000 son del gimnasio y 20.000 de fuera.
    const ab1 = ventas.abonar({ ventaId: vMixta.ventaId, monto: 10000, metodo: 'Efectivo', usuarioId });
    check('el primer abono cubre primero lo del gimnasio', ab1.ok && ab1.dentro === 6000 && ab1.saldo === 16000, JSON.stringify(ab1));
    check('y al cajon entra solo eso', caja.resumen(sesion).esperado === esperado0 + 6000,
          'esperado=' + caja.resumen(sesion).esperado);
    const ab2 = ventas.abonar({ ventaId: vMixta.ventaId, monto: 16000, metodo: 'Efectivo', usuarioId });
    check('el resto es de fuera y no entra al cajon',
          ab2.ok && ab2.dentro === 0 && caja.resumen(sesion).esperado === esperado0 + 6000, JSON.stringify(ab2));
    check('la venta queda pagada', ventas.saldoFiado(vMixta.ventaId).saldo === 0);
    check('y ya no sale entre las pendientes', !ventas.fiadasPendientes(cami).some(v => v.id === vMixta.ventaId));

    const ing2 = dash.ingresosDelDia(hoy);
    const efectivo = ing2.ventas.porMedio.find(m => m.medio === 'Efectivo');
    check('lo cobrado hoy si cuenta como ingreso, por su medio', efectivo && efectivo.monto === 6000,
          JSON.stringify(ing2.ventas.porMedio));
    check('y lo de fuera cobrado va a fuera de caja', ing2.fueraDeCaja.total === 20000, 'fuera=' + ing2.fueraDeCaja.total);
    check('los cobros del dia se listan para la Caja', ventas.abonosDelDia(hoy).total === 26000);

    const stockAntesDeAnular = productos.obtenerPorId(agua).stock;
    const anulada = ventas.anular({ ventaId: vMixta.ventaId, usuarioId, motivo: 'prueba' });
    check('anular una venta fiada devuelve solo el efectivo que entro al cajon',
          anulada.ok && anulada.devuelto === 6000 && caja.resumen(sesion).esperado === esperado0, JSON.stringify(anulada));
    check('devuelve el stock', productos.obtenerPorId(agua).stock === stockAntesDeAnular + 2);
    check('y anula sus abonos', ventas.listarAbonos(vMixta.ventaId).every(a => a.anulada === 1));
    check('los ingresos del dia vuelven a no contarla', dash.ingresosDelDia(hoy).ventas.porMedio.every(m => m.medio !== 'Efectivo'));

    // Una venta con tarjeta anulada no dice que salio dinero del cajon.
    const tarjeta = ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Tarjeta', usuarioId });
    check('anular una venta con tarjeta no devuelve efectivo',
          ventas.anular({ ventaId: tarjeta.ventaId, usuarioId }).devuelto === 0);

    // ======================================================= cuenta del cliente
    // Ana: membresia fiada de 70.000 (empezo hace 5 dias) + agua fiada hoy.
    const vAna = ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Fiado', usuarioId, clienteId: ana });
    const cuenta = fiados.cuentaDeCliente(ana);
    check('la cuenta junta membresia y tienda', cuenta.total === 73000 && cuenta.items.length === 2, JSON.stringify(cuenta));
    check('lo mas viejo va primero', cuenta.items[0].tipo === 'membresia' && cuenta.items[1].id === vAna.ventaId);
    check('nada esta vencido', cuenta.vencido === false);

    const lateral = panel.panelLateral().conSaldo.find(c => c.id === ana);
    check('la lista de quienes deben suma las dos cosas',
          lateral && lateral.saldoPendiente === 73000 && lateral.ventasFiadas.length === 1
          && lateral.membresiasConSaldo[0].fiadoHasta === dia(3), JSON.stringify(lateral));

    check('no se cobra mas de lo que debe',
          fiados.cobrar({ clienteId: ana, monto: 73001, metodo: 'QR', usuarioId }).motivo === 'mas_que_la_deuda');
    check('ni con Fiado', fiados.cobrar({ clienteId: ana, monto: 1000, metodo: 'Fiado', usuarioId }).motivo === 'medio_pago_invalido');

    caja.cerrar({ efectivoContado: caja.resumen(sesion).esperado });
    const pagosAntes = db.prepare('SELECT COUNT(*) AS n FROM pagos').get().n;
    const abonosAntes = db.prepare('SELECT COUNT(*) AS n FROM venta_abonos').get().n;
    const sinCaja = fiados.cobrar({ clienteId: ana, monto: 73000, metodo: 'Efectivo', usuarioId });
    check('cobrar en efectivo sin caja se rechaza', !sinCaja.ok && sinCaja.motivo === 'sin_caja_abierta', JSON.stringify(sinCaja));
    check('y no queda NADA aplicado a medias',
          db.prepare('SELECT COUNT(*) AS n FROM pagos').get().n === pagosAntes
          && db.prepare('SELECT COUNT(*) AS n FROM venta_abonos').get().n === abonosAntes);
    // Desde la 1.0.3 tampoco por QR: todo cobro entra a la caja con su medio.
    const qrSinCaja = fiados.cobrar({ clienteId: ana, monto: 3000, metodo: 'QR', usuarioId });
    check('cobrar por QR sin caja tambien se rechaza', !qrSinCaja.ok && qrSinCaja.motivo === 'sin_caja_abierta',
          JSON.stringify(qrSinCaja));

    caja.abrir({ usuarioId, baseInicial: 0 });
    const sesion2 = caja.sesionAbierta().id;

    // El caso feo: la primera parte (la membresia) SI se aplica y la segunda (la
    // venta) revienta. Se simula rompiendo el abono a proposito.
    const abonoDeVerdad = ventas.abonarSinAtrapar;
    ventas.abonarSinAtrapar = () => { throw new ventas.AbonoRechazado('fallo_simulado'); };
    const aMedias = fiados.cobrar({ clienteId: ana, monto: 73000, metodo: 'QR', usuarioId });
    ventas.abonarSinAtrapar = abonoDeVerdad;
    check('si falla la segunda parte del cobro, se rechaza entero', !aMedias.ok && aMedias.motivo === 'fallo_simulado',
          JSON.stringify(aMedias));
    check('y la primera parte (el pago de la membresia) tampoco queda',
          db.prepare('SELECT COUNT(*) AS n FROM pagos').get().n === pagosAntes && membresias.calcularSaldoPendiente(mAna) === 70000);

    const parcial = fiados.cobrar({ clienteId: ana, monto: 3000, metodo: 'QR', usuarioId });
    check('un abono parcial se aplica a lo mas viejo',
          parcial.ok && parcial.aplicado.length === 1 && parcial.aplicado[0].tipo === 'membresia' && parcial.debeTodavia === 70000,
          JSON.stringify(parcial));
    check('como un pago de membresia de verdad', membresias.listarPagos(mAna).some(p => p.monto === 3000 && p.metodo === 'QR'));
    check('que entra a la caja como QR, fuera del arqueo',
          caja.resumen(sesion2).porMedio.some(f => f.medio === 'QR' && f.neto === 3000) && caja.resumen(sesion2).esperado === 0,
          JSON.stringify(caja.resumen(sesion2).porMedio));
    const resto = fiados.cobrar({ clienteId: ana, monto: 70000, metodo: 'Efectivo', usuarioId });
    check('cobrar el resto reparte entre las dos deudas',
          resto.ok && resto.aplicado.length === 2 && resto.aplicado[0].monto === 67000 && resto.aplicado[1].monto === 3000,
          JSON.stringify(resto));
    check('todo el efectivo entra al cajon', caja.resumen(sesion2).esperado === 70000, 'esperado=' + caja.resumen(sesion2).esperado);
    check('la cuenta queda en cero', fiados.cuentaDeCliente(ana).total === 0);
    check('ya no sale en la lista de quienes deben', !panel.panelLateral().conSaldo.some(c => c.id === ana));
    check('sin deuda no hay nada que cobrar', fiados.cobrar({ clienteId: ana, monto: 1, metodo: 'QR', usuarioId }).motivo === 'sin_deuda');

    // Una venta fiada con fecha vencida marca la cuenta, pero no bloquea la entrada
    // (Andrey decidio el bloqueo solo para membresias).
    const vVieja = ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Fiado', usuarioId, clienteId: cami, fiadoHasta: dia(1) });
    db.prepare('UPDATE ventas SET fiado_hasta = ? WHERE id = ?').run(dia(-2), vVieja.ventaId);
    check('una venta fiada vencida marca la cuenta como vencida', fiados.cuentaDeCliente(cami).vencido === true);

    // ========================================================= mantenimiento
    const mantenimiento = require('../electron/services/mantenimiento');
    const vaciado = mantenimiento.vaciar(['ventas']);
    check('vaciar ventas se lleva tambien los abonos de fiados',
          vaciado.ok && db.prepare('SELECT COUNT(*) AS n FROM venta_abonos').get().n === 0, JSON.stringify(vaciado));

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
