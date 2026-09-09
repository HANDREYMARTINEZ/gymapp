const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-caja-detalle-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-caja-detalle-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const { format } = require('date-fns');
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();
    const caja = require('../electron/db/repos/caja');
    const productos = require('../electron/db/repos/productos');
    const ventas = require('../electron/db/repos/ventas');
    const membresias = require('../electron/db/repos/membresias');
    const planes = require('../electron/db/repos/planes');
    const clientes = require('../electron/db/repos/clientes');
    const dash = require('../electron/db/repos/dashboard');

    const hoy = format(new Date(), 'yyyy-MM-dd');
    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Cajero', 'cajero', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;

    const agua = productos.crear({ nombre: 'Agua', p_venta: 3000, p_costo: 1000, stock: 100 }).id;
    const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 70000, dias_duracion: 30 });
    const ana = clientes.crear({ documento: '111', nombre: 'Ana', telefono: '300' });
    const beto = clientes.crear({ documento: '222', nombre: 'Beto', telefono: '301' });

    caja.abrir({ usuarioId, baseInicial: 100000 });
    const sesionId = caja.sesionAbierta().id;

    // Mostrador: dos ventas en efectivo y una por Nequi, que no toca el cajon.
    ventas.registrar({ items: [{ productoId: agua, cantidad: 2 }], metodoPago: 'Efectivo', usuarioId });
    ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Efectivo', usuarioId });
    ventas.registrar({ items: [{ productoId: agua, cantidad: 5 }], metodoPago: 'Nequi', usuarioId });

    // Membresias: una en efectivo y otra por tarjeta.
    const mAna = membresias.vender({ clienteId: ana, planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: mAna, monto: 70000, metodo: 'Efectivo', usuarioId });
    const mBeto = membresias.vender({ clienteId: beto, planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: mBeto, monto: 50000, metodo: 'Tarjeta', usuarioId });

    // Y un movimiento escrito a mano.
    caja.registrarMovimiento({ tipo: 'egreso', concepto: 'Domicilio del almuerzo', monto: 15000, usuarioId });

    // ------------------------------------------------------- origen guardado
    const r = caja.resumen(sesionId);
    const de = (o) => r.porOrigen.find(x => x.origen === o) || { ingresos: 0, egresos: 0 };

    check('cada movimiento sabe de donde viene',
          r.movimientos.every(m => ['venta', 'membresia', 'manual'].includes(m.origen)),
          r.movimientos.map(m => m.origen).join(', '));
    check('las ventas del mostrador van marcadas como venta',
          de('venta').ingresos === 9000, 'venta=' + de('venta').ingresos);
    check('los pagos de membresia, como membresia',
          de('membresia').ingresos === 70000, 'membresia=' + de('membresia').ingresos);
    check('lo escrito a mano, como manual',
          de('manual').egresos === 15000, 'manual=' + de('manual').egresos);
    check('lo cobrado por Nequi y tarjeta no entra al cajon',
          r.ingresos === 9000 + 70000, 'ingresos=' + r.ingresos);

    // El criterio de la etapa: que los numeros de pantalla cuadren con la base.
    const sumaOrigenes = r.porOrigen.reduce((s, o) => s + o.ingresos - o.egresos, 0);
    check('el desglose por origen suma exactamente el movimiento neto del cajon',
          sumaOrigenes === r.ingresos - r.egresos,
          sumaOrigenes + ' vs ' + (r.ingresos - r.egresos));
    check('y el esperado del arqueo sale de ahi',
          r.esperado === 100000 + sumaOrigenes, 'esperado=' + r.esperado);

    // -------------------------------------- lo que ve la columna de la derecha
    const delDia = ventas.listarDelDia(hoy).filter(v => !v.anulada);
    check('las ventas del dia son las tres, tambien la de Nequi', delDia.length === 3,
          'ventas=' + delDia.length);
    check('y su total incluye lo que no paso por el cajon',
          delDia.reduce((s, v) => s + v.total, 0) === 9000 + 15000);

    const pagos = membresias.pagosDelDia(hoy);
    check('los pagos de membresia del dia salen con su cliente y su plan',
          pagos.pagos.length === 2 && pagos.pagos.every(p => p.cliente_nombre && p.plan_nombre),
          'pagos=' + pagos.pagos.length);
    check('y suman lo cobrado por todos los medios', pagos.total === 120000, 'total=' + pagos.total);

    // ------------------------------------ desglose por medio de pago del dia
    const ingresos = dash.ingresosDelDia(hoy);
    const medio = (lista, m) => (lista.find(x => x.medio === m) || { monto: 0 }).monto;
    check('el desglose separa efectivo de Nequi en las ventas',
          medio(ingresos.ventas.porMedio, 'Efectivo') === 9000 &&
          medio(ingresos.ventas.porMedio, 'Nequi') === 15000,
          'efectivo=' + medio(ingresos.ventas.porMedio, 'Efectivo') +
          ' nequi=' + medio(ingresos.ventas.porMedio, 'Nequi'));
    check('y efectivo de tarjeta en las membresias',
          medio(ingresos.membresias.porMedio, 'Efectivo') === 70000 &&
          medio(ingresos.membresias.porMedio, 'Tarjeta') === 50000);
    check('el total del dia es todo lo cobrado, pase o no por el cajon',
          ingresos.total === 24000 + 120000, 'total=' + ingresos.total);
    check('que es mas que lo que hay en el cajon, y con razon',
          ingresos.total > r.ingresos, ingresos.total + ' vs ' + r.ingresos);

    // ---------------------------------- anular deja rastro con el mismo origen
    const paraAnular = db.prepare(`SELECT id FROM ventas WHERE metodo_pago = 'Efectivo' ORDER BY id LIMIT 1`).get().id;
    ventas.anular({ ventaId: paraAnular, usuarioId, motivo: 'error' });
    const r2 = caja.resumen(sesionId);
    const venta2 = r2.porOrigen.find(o => o.origen === 'venta');
    check('la devolucion de una venta se apunta como venta, no como manual',
          venta2.egresos === 6000, 'egresos venta=' + venta2.egresos);
    check('y el neto de ese origen baja lo mismo',
          venta2.ingresos - venta2.egresos === 3000,
          'neto=' + (venta2.ingresos - venta2.egresos));

    // ------------------------------------------ detalle de una caja cerrada
    caja.cerrar({ efectivoContado: r2.esperado });
    const cerrada = caja.listarSesiones(5).find(s => s.id === sesionId);
    check('la caja queda cerrada y cuadrada',
          !!cerrada.cerrada_en && cerrada.diferencia === 0, 'diferencia=' + cerrada.diferencia);

    const detalle = caja.resumen(sesionId);
    check('una caja ya cerrada sigue devolviendo todos sus movimientos',
          detalle.movimientos.length === r2.movimientos.length && detalle.movimientos.length > 0,
          'movimientos=' + detalle.movimientos.length);
    check('con su desglose por origen intacto',
          detalle.porOrigen.length === 3, 'origenes=' + detalle.porOrigen.length);
    check('y los movimientos vienen con el nombre de quien los hizo',
          detalle.movimientos.every(m => m.usuario_nombre === 'Cajero'));

    check('el resumen de una caja que no existe es null', caja.resumen(9999) === null);

    // -------------------- una caja nueva no arrastra los movimientos de la otra
    caja.abrir({ usuarioId, baseInicial: 50000 });
    const nueva = caja.resumen(caja.sesionAbierta().id);
    check('la caja nueva empieza vacia', nueva.movimientos.length === 0 && nueva.porOrigen.length === 0);
    check('y la anterior conserva los suyos',
          caja.resumen(sesionId).movimientos.length === detalle.movimientos.length);

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
