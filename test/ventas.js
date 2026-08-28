const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-ventas-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-ventas-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();
    const productos = require('../electron/db/repos/productos');
    const caja = require('../electron/db/repos/caja');
    const ventas = require('../electron/db/repos/ventas');
    const membresias = require('../electron/db/repos/membresias');

    db.prepare(`
      INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
      VALUES ('Cajero', 'cajero', 'x', 'asistente', 1, ?)
    `).run(new Date().toISOString());
    const usuarioId = 1;

    const agua = productos.crear({ nombre: 'Agua', p_venta: 3000, p_costo: 1800, stock: 10 }).id;
    const barra = productos.crear({ nombre: 'Barra', p_venta: 5000, p_costo: 3000, stock: 4 }).id;

    // --- validaciones de entrada ---
    check('rechaza una venta sin items',
          !ventas.registrar({ items: [], metodoPago: 'Efectivo', usuarioId }).ok);
    check('rechaza un medio de pago inventado',
          ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Bitcoin', usuarioId }).motivo === 'medio_pago_invalido');
    check('rechaza cantidad cero',
          ventas.registrar({ items: [{ productoId: agua, cantidad: 0 }], metodoPago: 'Efectivo', usuarioId }).motivo === 'cantidad_invalida');

    // --- efectivo sin caja abierta ---
    const sinCaja = ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Efectivo', usuarioId });
    check('bloquea la venta en efectivo sin caja abierta',
          !sinCaja.ok && sinCaja.motivo === 'sin_caja_abierta', 'motivo=' + sinCaja.motivo);
    check('el bloqueo NO descuenta stock', productos.obtenerPorId(agua).stock === 10,
          'stock=' + productos.obtenerPorId(agua).stock);

    // --- tarjeta sin caja abierta si pasa ---
    const conTarjeta = ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Tarjeta', usuarioId });
    check('la venta con tarjeta si pasa sin caja abierta', conTarjeta.ok, 'motivo=' + conTarjeta.motivo);
    check('la venta con tarjeta si descuenta stock', productos.obtenerPorId(agua).stock === 9);

    // --- se abre la caja ---
    caja.abrir({ usuarioId, baseInicial: 20000 });

    const v = ventas.registrar({
      items: [{ productoId: agua, cantidad: 2 }, { productoId: barra, cantidad: 1 }],
      metodoPago: 'Efectivo', usuarioId,
    });
    check('venta en efectivo con caja abierta', v.ok, 'motivo=' + v.motivo);
    check('el total suma bien', v.total === 11000, 'total=' + v.total); // 2*3000 + 5000
    check('descuenta el stock de cada producto',
          productos.obtenerPorId(agua).stock === 7 && productos.obtenerPorId(barra).stock === 3);

    const resumenCaja = caja.resumen(caja.sesionAbierta().id);
    check('la venta en efectivo entro al arqueo', resumenCaja.ingresos === 11000,
          'ingresos=' + resumenCaja.ingresos);
    check('el esperado subio con la venta', resumenCaja.esperado === 31000,
          'esperado=' + resumenCaja.esperado);

    // --- la venta congela nombre y precios ---
    const detalle = ventas.obtener(v.ventaId);
    check('la venta guarda sus items', detalle.items.length === 2);
    check('guarda el nombre del momento', detalle.items.some(i => i.producto_nombre === 'Agua'));
    check('guarda el costo unitario del momento',
          detalle.items.find(i => i.producto_id === agua).p_costo_unit === 1800);

    productos.editar(agua, { nombre: 'Agua 600', p_venta: 9999, p_costo: 8888, stock_min: 0, codigo_barras: '' });
    const trasCambio = ventas.obtener(v.ventaId);
    check('cambiar el precio hoy NO altera la venta de ayer',
          trasCambio.items.find(i => i.producto_id === agua).p_unitario === 3000);
    check('renombrar el producto NO altera la venta de ayer',
          trasCambio.items.find(i => i.producto_id === agua).producto_nombre === 'Agua');
    check('el total historico no se movio', trasCambio.total === 11000);

    // --- stock insuficiente ---
    const sinStock = ventas.registrar({
      items: [{ productoId: barra, cantidad: 99 }], metodoPago: 'Efectivo', usuarioId,
    });
    check('rechaza vender mas de lo que hay',
          !sinStock.ok && sinStock.motivo === 'stock_insuficiente', 'motivo=' + sinStock.motivo);
    check('el rechazo dice que producto fue', sinStock.nombre === 'Barra', 'nombre=' + sinStock.nombre);

    // --- atomicidad: una linea invalida tumba toda la venta ---
    const stockAguaAntes = productos.obtenerPorId(agua).stock;
    const mixta = ventas.registrar({
      items: [{ productoId: agua, cantidad: 1 }, { productoId: barra, cantidad: 99 }],
      metodoPago: 'Efectivo', usuarioId,
    });
    check('una linea sin stock tumba la venta entera', !mixta.ok);
    check('el producto que si tenia stock no quedo descontado',
          productos.obtenerPorId(agua).stock === stockAguaAntes,
          'stock=' + productos.obtenerPorId(agua).stock);
    check('no quedo un ingreso de caja huerfano',
          caja.resumen(caja.sesionAbierta().id).ingresos === 11000);

    // --- dos lineas del mismo producto se suman antes de validar ---
    // Quedan 3 barras: 2 + 2 son 4 y debe rechazarse, no pasar por ser 2 y 2.
    const dobleLinea = ventas.registrar({
      items: [{ productoId: barra, cantidad: 2 }, { productoId: barra, cantidad: 2 }],
      metodoPago: 'Efectivo', usuarioId,
    });
    check('dos lineas del mismo producto se validan sumadas',
          !dobleLinea.ok && dobleLinea.motivo === 'stock_insuficiente', 'motivo=' + dobleLinea.motivo);
    check('y no dejaron stock descontado a medias', productos.obtenerPorId(barra).stock === 3);

    // --- producto inactivo ---
    productos.desactivar(barra);
    const inactivo = ventas.registrar({ items: [{ productoId: barra, cantidad: 1 }], metodoPago: 'Efectivo', usuarioId });
    check('no deja vender un producto inactivo',
          !inactivo.ok && inactivo.motivo === 'producto_inactivo', 'motivo=' + inactivo.motivo);
    productos.activar(barra);

    // --- anulacion ---
    const ingresosAntes = caja.resumen(caja.sesionAbierta().id).ingresos;
    const an = ventas.anular({ ventaId: v.ventaId, usuarioId, motivo: 'cliente se arrepintio' });
    check('anular devuelve ok', an.ok, 'motivo=' + an.motivo);
    check('la anulacion devuelve el stock',
          productos.obtenerPorId(agua).stock === stockAguaAntes + 2 && productos.obtenerPorId(barra).stock === 4);
    const trasAnular = caja.resumen(caja.sesionAbierta().id);
    check('la anulacion saca el dinero del cajon con un egreso',
          trasAnular.egresos === 11000, 'egresos=' + trasAnular.egresos);
    check('los ingresos no se tocaron (queda el rastro de ambos)',
          trasAnular.ingresos === ingresosAntes);
    check('la venta queda marcada, no borrada', ventas.obtener(v.ventaId).anulada === 1);
    check('no se puede anular dos veces',
          ventas.anular({ ventaId: v.ventaId, usuarioId }).motivo === 'ya_anulada');

    // --- totales del dia excluyen anuladas ---
    const hoy = new Date().toISOString();
    const tot = ventas.totalesDelDia(hoy);
    check('los totales del dia excluyen la anulada', tot.total === 3000, 'total=' + tot.total);
    check('listarDelDia si muestra la anulada',
          ventas.listarDelDia(hoy).some(x => x.id === v.ventaId && x.anulada === 1));

    // --- pago de membresia en efectivo entra al arqueo ---
    db.prepare(`INSERT INTO clientes (nombre, f_registro, activo) VALUES ('Cliente', ?, 1)`)
      .run(new Date().toISOString().slice(0, 10));
    db.prepare(`INSERT INTO planes (nombre, tipo, precio, dias_duracion, activo) VALUES ('Mensual', 'periodo', 100000, 30, 1)`).run();
    const membresiaId = membresias.vender({ clienteId: 1, planId: 1, usuarioId });

    const egresosAntes = caja.resumen(caja.sesionAbierta().id).egresos;
    const pago = membresias.registrarPago({ membresiaId, monto: 100000, metodo: 'Efectivo', usuarioId });
    check('el pago de membresia en efectivo se registra', pago.ok, 'motivo=' + pago.motivo);
    const trasPago = caja.resumen(caja.sesionAbierta().id);
    check('el pago de membresia en efectivo entra al arqueo',
          trasPago.ingresos === ingresosAntes + 100000, 'ingresos=' + trasPago.ingresos);
    check('el pago no toco los egresos', trasPago.egresos === egresosAntes);

    const pagoTarjeta = membresias.registrarPago({ membresiaId, monto: 5000, metodo: 'Tarjeta', usuarioId });
    check('un pago con tarjeta se registra igual', pagoTarjeta.ok);
    check('pero NO entra al arqueo',
          caja.resumen(caja.sesionAbierta().id).ingresos === trasPago.ingresos,
          'ingresos=' + caja.resumen(caja.sesionAbierta().id).ingresos);

    // --- pago en efectivo sin caja: se bloquea y no deja pago suelto ---
    caja.cerrar({ efectivoContado: caja.resumen(caja.sesionAbierta().id).esperado });
    const pagosAntes = membresias.listarPagos(membresiaId).length;
    const pagoSinCaja = membresias.registrarPago({ membresiaId, monto: 1000, metodo: 'Efectivo', usuarioId });
    check('bloquea el pago en efectivo sin caja abierta',
          !pagoSinCaja.ok && pagoSinCaja.motivo === 'sin_caja_abierta', 'motivo=' + pagoSinCaja.motivo);
    check('el bloqueo no dejo el pago registrado',
          membresias.listarPagos(membresiaId).length === pagosAntes,
          membresias.listarPagos(membresiaId).length + ' pagos');

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
