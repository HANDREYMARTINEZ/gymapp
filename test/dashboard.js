const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-dashboard-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-dashboard-' + Date.now());
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
    const asistencias = require('../electron/db/repos/asistencias');
    const dash = require('../electron/db/repos/dashboard');

    const hoy = format(new Date(), 'yyyy-MM-dd');
    const enDias = (n) => format(addDays(new Date(), n), 'yyyy-MM-dd');

    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Cajero', 'cajero', 'x', 'asistente', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;

    // --- dashboard vacio ---
    const vacio = dash.resumen();
    check('con la base vacia el total del dia es 0', vacio.ingresos.total === 0);
    check('sin caja abierta el bloque de caja va en null', vacio.caja === null);
    check('sin datos, por vencer viene vacio', vacio.porVencer.length === 0);
    check('la serie de asistencias trae 7 puntos aun sin datos',
          vacio.asistenciasSerie.length === 7, vacio.asistenciasSerie.length + ' puntos');
    check('y todos en cero', vacio.asistenciasSerie.every(p => p.n === 0));
    check('el ultimo punto de la serie es hoy',
          vacio.asistenciasSerie[6].fecha === hoy, vacio.asistenciasSerie[6].fecha);

    // --- datos ---
    const agua = productos.crear({ nombre: 'Agua', p_venta: 3000, p_costo: 1800, stock: 10, stock_min: 2 }).id;
    const toalla = productos.crear({ nombre: 'Toalla', p_venta: 20000, p_costo: 12000, stock: 1, stock_min: 5 }).id;

    caja.abrir({ usuarioId, baseInicial: 50000 });

    ventas.registrar({ items: [{ productoId: agua, cantidad: 2 }], metodoPago: 'Efectivo', usuarioId });
    ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Tarjeta', usuarioId });
    const anulable = ventas.registrar({ items: [{ productoId: agua, cantidad: 3 }], metodoPago: 'Tarjeta', usuarioId });
    ventas.anular({ ventaId: anulable.ventaId, usuarioId, motivo: 'prueba' });

    const ing = dash.ingresosDelDia(hoy);
    check('suma las ventas del dia por medio de pago', ing.ventas.total === 9000,
          'total ventas=' + ing.ventas.total); // 6000 efectivo + 3000 tarjeta
    check('la venta anulada NO cuenta', ing.ventas.total === 9000);
    check('separa efectivo de tarjeta',
          ing.ventas.porMedio.find(m => m.medio === 'Efectivo').monto === 6000 &&
          ing.ventas.porMedio.find(m => m.medio === 'Tarjeta').monto === 3000);

    // --- pagos de membresia ---
    db.prepare(`INSERT INTO clientes (nombre, f_registro, activo) VALUES ('Cliente Uno', ?, 1)`).run(hoy);
    db.prepare(`INSERT INTO clientes (nombre, f_registro, activo) VALUES ('Cliente Dos', ?, 1)`).run(hoy);
    db.prepare(`INSERT INTO planes (nombre, tipo, precio, dias_duracion, activo)
                VALUES ('Mensual', 'periodo', 100000, 30, 1)`).run();
    db.prepare(`INSERT INTO planes (nombre, tipo, precio, num_tickets, dias_vigencia, activo)
                VALUES ('Diez clases', 'ticketera', 80000, 10, 60, 1)`).run();

    const m1 = membresias.vender({ clienteId: 1, planId: 1, usuarioId });
    membresias.registrarPago({ membresiaId: m1, monto: 100000, metodo: 'Efectivo', usuarioId });

    const ing2 = dash.ingresosDelDia(hoy);
    check('el pago de membresia entra en su propio bloque', ing2.membresias.total === 100000,
          'membresias=' + ing2.membresias.total);
    check('las ventas no se contaminaron con el pago', ing2.ventas.total === 9000);
    check('el total del dia suma ambas fuentes', ing2.total === 109000, 'total=' + ing2.total);

    // --- que se vendio, cosa por cosa ---
    const vendidos = dash.productosVendidos(hoy);
    check('el detalle trae una fila por producto vendido', vendidos.length === 1,
          vendidos.length + ' filas');
    check('con su nombre, sus unidades y su importe',
          vendidos[0].nombre === 'Agua' && vendidos[0].unidades === 3 && vendidos[0].monto === 9000,
          JSON.stringify(vendidos[0]));
    check('la venta anulada tampoco cuenta en el detalle',
          vendidos.reduce((s, f) => s + f.monto, 0) === ing2.ventas.total);
    check('un producto que no se vendio no aparece',
          !vendidos.some(f => f.id === toalla));
    check('marca si la fila es de dentro o de fuera de caja',
          vendidos[0].fueraDeCaja === 0, 'fueraDeCaja=' + vendidos[0].fueraDeCaja);

    const planesVendidos = dash.membresiasVendidas(hoy);
    check('el detalle de membresias agrupa por plan', planesVendidos.length === 1,
          planesVendidos.length + ' filas');
    check('con el nombre del plan, cuantos pagos y cuanto dinero',
          planesVendidos[0].nombre === 'Mensual' && planesVendidos[0].pagos === 1 &&
          planesVendidos[0].monto === 100000, JSON.stringify(planesVendidos[0]));
    check('lo cobrado por planes cuadra con el bloque de membresias',
          planesVendidos.reduce((s, f) => s + f.monto, 0) === ing2.membresias.total);
    check('el detalle de ayer viene vacio', dash.productosVendidos(enDias(-1)).length === 0);

    // --- asistencias ---
    check('asistencias del dia arranca en 0', dash.asistenciasDelDia(hoy) === 0);
    const asis = asistencias.registrar({ clienteId: 1, metodo: 'manual', registradoPor: usuarioId });
    check('la asistencia se registro', asis.ok, 'motivo=' + asis.motivo);
    check('asistencias del dia ya cuenta 1', dash.asistenciasDelDia(hoy) === 1);
    const serie = dash.asistenciasUltimosDias(7);
    check('la serie refleja la asistencia de hoy', serie[6].n === 1, 'n=' + serie[6].n);
    check('los dias anteriores siguen en cero', serie.slice(0, 6).every(p => p.n === 0));

    // --- membresias por vencer ---
    // m1 vence en 30 dias: con aviso de 5 dias no debe aparecer todavia.
    check('una membresia lejos de vencer no aparece',
          dash.membresiasPorVencer(5).length === 0, dash.membresiasPorVencer(5).length + ' encontradas');

    // Se acerca su vencimiento a 3 dias.
    db.prepare(`UPDATE membresias SET f_fin = ? WHERE id = ?`).run(enDias(3), m1);
    const porVencer = dash.membresiasPorVencer(5);
    check('al acercarse el vencimiento si aparece', porVencer.length === 1,
          porVencer.length + ' encontradas');
    check('trae el nombre del cliente para poder llamarlo',
          porVencer[0].clienteNombre === 'Cliente Uno', porVencer[0].clienteNombre);
    check('el estado viene de estadoMembresia, no de SQL',
          porVencer[0].estado === 'por_vencer', porVencer[0].estado);

    // Una membresia pausada NO esta por vencer: su estado es 'pausada'. Esto es
    // lo que se perderia si el filtro se hiciera solo en SQL sobre f_fin.
    db.prepare(`INSERT INTO membresia_pausas (membresia_id, f_inicio, motivo, usuario_id, creada_en)
                VALUES (?, ?, 'viaje', ?, ?)`).run(m1, hoy, usuarioId, new Date().toISOString());
    check('una membresia pausada deja de figurar como por vencer',
          dash.membresiasPorVencer(5).length === 0,
          'el estado real manda sobre la fecha');
    db.prepare(`DELETE FROM membresia_pausas WHERE membresia_id = ?`).run(m1);

    // Con saldo pendiente el estado es 'saldo_pendiente', tampoco 'por_vencer'.
    const m2 = membresias.vender({ clienteId: 2, planId: 1, usuarioId });
    db.prepare(`UPDATE membresias SET f_fin = ? WHERE id = ?`).run(enDias(2), m2);
    check('una membresia con saldo pendiente tampoco figura por vencer',
          !dash.membresiasPorVencer(5).some(m => m.id === m2),
          'saldo=' + membresias.calcularSaldoPendiente(m2));

    // Ticketera con pocos tickets.
    const m3 = membresias.vender({ clienteId: 2, planId: 2, usuarioId });
    membresias.registrarPago({ membresiaId: m3, monto: 80000, metodo: 'Tarjeta', usuarioId });
    db.prepare(`UPDATE membresias SET tickets_usados = 9 WHERE id = ?`).run(m3);
    const conTicketera = dash.membresiasPorVencer(5);
    check('una ticketera con 1 ticket aparece por vencer',
          conTicketera.some(m => m.id === m3), conTicketera.length + ' encontradas');
    const t = conTicketera.find(m => m.id === m3);
    check('y dice cuantos tickets le quedan', t && t.ticketsRestantes === 1,
          'restantes=' + (t ? t.ticketsRestantes : 'n/a'));

    // --- bajo minimo y caja ---
    const r = dash.resumen();
    check('toalla aparece bajo minimo', r.bajoMinimo.some(p => p.id === toalla), 'stock=1 min=5');
    check('agua no aparece bajo minimo', !r.bajoMinimo.some(p => p.id === agua));
    check('con caja abierta el resumen la trae', r.caja !== null);
    check('el resumen trae el detalle de lo vendido',
          r.vendido.productos.length === 1 &&
          r.vendido.membresias.some(f => f.nombre === 'Mensual') &&
          r.vendido.membresias.some(f => f.nombre === 'Diez clases'),
          JSON.stringify(r.vendido));
    check('y lo del detalle suma lo mismo que las cifras de arriba',
          r.vendido.membresias.reduce((s, f) => s + f.monto, 0) === r.ingresos.membresias.total &&
          r.vendido.productos.reduce((s, f) => s + f.monto, 0) === r.ingresos.ventas.total,
          'membresias=' + r.ingresos.membresias.total + ' ventas=' + r.ingresos.ventas.total);
    check('el esperado de caja incluye la venta y el pago en efectivo',
          r.caja.esperado === 156000, 'esperado=' + r.caja.esperado); // 50000 + 6000 + 100000

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
