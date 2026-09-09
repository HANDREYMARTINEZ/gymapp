const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-fuera-de-caja-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-fuera-de-caja-' + Date.now());
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
    const productos = require('../electron/db/repos/productos');
    const ventas = require('../electron/db/repos/ventas');
    const caja = require('../electron/db/repos/caja');
    const dash = require('../electron/db/repos/dashboard');

    const hoy = format(new Date(), 'yyyy-MM-dd');
    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Cajero', 'cajero', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;

    // Agua es del gimnasio. La crema la vende otro y su dinero va aparte.
    const agua = productos.crear({ nombre: 'Agua', p_venta: 3000, p_costo: 1000, stock: 100, stock_min: 5 }).id;
    const crema = productos.crear({ nombre: 'Crema ajena', p_venta: 20000, p_costo: 0, stock: 100,
                                    stock_min: 0, fuera_de_caja: true }).id;

    check('el producto guarda de que lado esta',
          productos.obtenerPorId(agua).fuera_de_caja === 0 &&
          productos.obtenerPorId(crema).fuera_de_caja === 1);
    check('por defecto un producto es del gimnasio',
          productos.crear({ nombre: 'Sin decir', p_venta: 1000, stock: 1 }).id > 0 &&
          productos.obtenerPorId(3).fuera_de_caja === 0);

    // ------------------------------------------------ venta solo del gimnasio
    caja.abrir({ usuarioId, baseInicial: 100000 });
    const sesionId = caja.sesionAbierta().id;
    const soloDentro = ventas.registrar({ items: [{ productoId: agua, cantidad: 2 }],
                                          metodoPago: 'Efectivo', usuarioId });
    check('una venta normal sigue igual que siempre',
          soloDentro.ok && soloDentro.total === 6000 && soloDentro.totalFuera === 0,
          'total=' + soloDentro.total);
    check('y entra entera al cajon',
          caja.resumen(sesionId).ingresos === 6000, 'ingresos=' + caja.resumen(sesionId).ingresos);

    // ------------------------------------------------- ticket mezclado: lo clave
    const mezclada = ventas.registrar({
      items: [{ productoId: agua, cantidad: 1 }, { productoId: crema, cantidad: 2 }],
      metodoPago: 'Efectivo', usuarioId,
    });
    check('un ticket puede mezclar las dos cosas', mezclada.ok === true, 'motivo=' + mezclada.motivo);
    check('el total que se le cobra al cliente es el completo',
          mezclada.total === 43000, 'total=' + mezclada.total);
    check('se reparte en las dos cuentas',
          mezclada.totalDentro === 3000 && mezclada.totalFuera === 40000,
          'dentro=' + mezclada.totalDentro + ' fuera=' + mezclada.totalFuera);
    check('al cajon entra SOLO la parte del gimnasio',
          caja.resumen(sesionId).ingresos === 6000 + 3000,
          'ingresos=' + caja.resumen(sesionId).ingresos);
    check('el arqueo esperado no incluye lo de fuera',
          caja.resumen(sesionId).esperado === 100000 + 9000,
          'esperado=' + caja.resumen(sesionId).esperado);

    check('la linea de la venta guarda de que lado estaba',
          db.prepare(`SELECT fuera_de_caja FROM venta_items WHERE venta_id = ? AND producto_id = ?`)
            .get(mezclada.ventaId, crema).fuera_de_caja === 1);

    // ------------------------------------------ sin caja abierta
    caja.cerrar({ efectivoContado: 109000 });
    check('el cierre cuadra sin sobrantes falsos',
          db.prepare(`SELECT diferencia FROM caja_sesiones WHERE id = ?`).get(sesionId).diferencia === 0,
          'diferencia=' + db.prepare(`SELECT diferencia FROM caja_sesiones WHERE id = ?`).get(sesionId).diferencia);

    const soloFuera = ventas.registrar({ items: [{ productoId: crema, cantidad: 1 }],
                                         metodoPago: 'Efectivo', usuarioId });
    check('sin caja abierta SI se puede vender en efectivo algo de fuera',
          soloFuera.ok === true, 'motivo=' + soloFuera.motivo);
    check('y no crea ningun movimiento de caja',
          !db.prepare(`SELECT 1 FROM caja_movimientos WHERE concepto = 'Venta #' || ?`).get(soloFuera.ventaId));

    const rechazada = ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }],
                                         metodoPago: 'Efectivo', usuarioId });
    check('pero el efectivo del gimnasio sigue exigiendo caja abierta',
          rechazada.ok === false && rechazada.motivo === 'sin_caja_abierta', 'motivo=' + rechazada.motivo);
    check('y esa venta rechazada no descuenta stock',
          productos.obtenerPorId(agua).stock === 100 - 3,
          'stock=' + productos.obtenerPorId(agua).stock);

    const mixtaSinCaja = ventas.registrar({
      items: [{ productoId: agua, cantidad: 1 }, { productoId: crema, cantidad: 1 }],
      metodoPago: 'Efectivo', usuarioId,
    });
    check('un ticket mezclado sin caja abierta se rechaza entero',
          mixtaSinCaja.ok === false && mixtaSinCaja.motivo === 'sin_caja_abierta');
    check('y tampoco descuenta stock de la parte de fuera',
          productos.obtenerPorId(crema).stock === 100 - 3,
          'stock=' + productos.obtenerPorId(crema).stock);

    // ------------------------------------------------------------- anular
    caja.abrir({ usuarioId, baseInicial: 50000 });
    const sesion2 = caja.sesionAbierta().id;
    const paraAnular = ventas.registrar({
      items: [{ productoId: agua, cantidad: 2 }, { productoId: crema, cantidad: 1 }],
      metodoPago: 'Efectivo', usuarioId,
    });
    const antes = caja.resumen(sesion2).esperado;
    const an = ventas.anular({ ventaId: paraAnular.ventaId, usuarioId, motivo: 'error' });
    check('anular devuelve solo lo que entro al cajon',
          an.ok && an.devuelto === 6000 && an.fueraDeCaja === 20000,
          'devuelto=' + an.devuelto + ' fuera=' + an.fueraDeCaja);
    check('y la caja vuelve exactamente a donde estaba',
          caja.resumen(sesion2).esperado === antes - 6000,
          antes + ' -> ' + caja.resumen(sesion2).esperado);
    check('el stock se repone de los dos lados',
          productos.obtenerPorId(crema).stock === 100 - 3);

    // ------------------------------------------------ resumenes e informes
    const totales = ventas.totalesDelDia(hoy);
    check('los totales del dia separan las dos cuentas',
          totales.dentro === 9000 && totales.fuera === 60000,
          'dentro=' + totales.dentro + ' fuera=' + totales.fuera);
    check('y el total cobrado sigue siendo la suma de los dos',
          totales.total === totales.dentro + totales.fuera, 'total=' + totales.total);

    const ingresos = dash.ingresosDelDia(hoy);
    check('los ingresos del gimnasio NO cuentan lo de fuera',
          ingresos.ventas.total === 9000, 'ventas=' + ingresos.ventas.total);
    check('pero se puede ver aparte cuanto fue',
          ingresos.fueraDeCaja.total === 60000, 'fuera=' + ingresos.fueraDeCaja.total);
    check('y no se cuela en el total del dia',
          ingresos.total === ingresos.ventas.total + ingresos.membresias.total);

    const informe = ventas.fueraDeCajaDelDia(hoy);
    check('hay un historial aparte de lo de fuera', informe.total === 60000, 'total=' + informe.total);
    check('con sus lineas y unidades', informe.lineas.length === 2 && informe.unidades === 3,
          'lineas=' + informe.lineas.length + ' unidades=' + informe.unidades);
    check('sin colar en el las cosas del gimnasio',
          informe.lineas.every(l => l.producto_nombre === 'Crema ajena'));
    check('ni las ventas anuladas',
          !informe.lineas.some(l => l.venta_id === paraAnular.ventaId));
    check('el informe de un dia dice de que dia es', informe.fecha === hoy, informe.fecha);

    // ------------------------------------------- el mismo informe, por rango
    // Una venta de ayer, metida a mano: registrar() siempre pone la fecha de
    // ahora, y sin una linea vieja no hay rango que probar.
    const anteayer = new Date(Date.now() - 24 * 3600 * 1000);
    const ayer = format(anteayer, 'yyyy-MM-dd');
    const ventaVieja = db.prepare(
      `INSERT INTO ventas (fecha, total, metodo_pago, usuario_id, cliente_id, anulada)
       VALUES (?, 20000, 'Efectivo', ?, NULL, 0)`
    ).run(anteayer.toISOString(), usuarioId).lastInsertRowid;
    db.prepare(
      `INSERT INTO venta_items (venta_id, producto_id, producto_nombre, cantidad,
                                p_unitario, p_costo_unit, fuera_de_caja)
       VALUES (?, ?, 'Crema ajena', 1, 20000, 0, 1)`
    ).run(ventaVieja, crema);

    const rango = ventas.fueraDeCajaEntre(ayer, hoy);
    check('el rango suma los dos dias', rango.total === 80000, 'total=' + rango.total);
    check('con todas sus lineas y unidades',
          rango.lineas.length === 3 && rango.unidades === 4,
          'lineas=' + rango.lineas.length + ' unidades=' + rango.unidades);
    check('y dice desde y hasta donde miro', rango.desde === ayer && rango.hasta === hoy);
    check('el rango tambien suma por producto',
          rango.porProducto.length === 1 && rango.porProducto[0].unidades === 4 &&
          rango.porProducto[0].monto === 80000, JSON.stringify(rango.porProducto));
    check('no se corta: nada que truncar con tres lineas', rango.truncado === false);

    const alReves = ventas.fueraDeCajaEntre(hoy, ayer);
    check('las fechas al reves se enderezan solas',
          alReves.total === rango.total && alReves.desde === ayer, 'total=' + alReves.total);

    const soloAyer = ventas.fueraDeCajaEntre(ayer, ayer);
    check('un rango de un solo dia deja fuera lo demas',
          soloAyer.total === 20000 && soloAyer.lineas.length === 1, 'total=' + soloAyer.total);
    check('el informe de hoy no se entero de la venta vieja',
          ventas.fueraDeCajaDelDia(hoy).total === 60000);

    // ------------------------------- cambiar la marca no reescribe el pasado
    productos.editar(crema, { nombre: 'Crema ajena', p_venta: 20000, p_costo: 0,
                              stock_min: 0, codigo_barras: null, fuera_de_caja: false });
    check('cambiar la marca de un producto no cambia las ventas ya hechas',
          ventas.totalesDelDia(hoy).fuera === 60000,
          'fuera=' + ventas.totalesDelDia(hoy).fuera);
    check('ni el arqueo ya cerrado',
          db.prepare(`SELECT diferencia FROM caja_sesiones WHERE id = ?`).get(sesionId).diferencia === 0);

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
