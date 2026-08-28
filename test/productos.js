const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-productos-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-productos-' + Date.now());
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
    const repo = require('../electron/db/repos/productos');

    // Un usuario para poder atribuir los movimientos de stock.
    conn.getDb().prepare(`
      INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
      VALUES ('Test', 'test', 'x', 'admin', 1, ?)
    `).run(new Date().toISOString());
    const usuarioId = 1;

    // --- alta ---
    const a = repo.crear({ nombre: 'Agua 600ml', categoria: 'Bebidas', p_venta: 3000, p_costo: 1800, stock: 24, stock_min: 6, codigo_barras: '7702001' });
    check('crear devuelve ok con id', a.ok && a.id > 0, 'id=' + a.id);

    const b = repo.crear({ nombre: 'Proteina scoop', p_venta: 8000, p_costo: 5000 });
    check('crear sin opcionales usa los defectos', b.ok);
    const bDb = repo.obtenerPorId(b.id);
    check('stock y stock_min por defecto en 0', bDb.stock === 0 && bDb.stock_min === 0);
    check('p_costo por defecto respetado', bDb.p_costo === 5000);

    // --- el codigo de barras vacio no debe chocar ---
    const c = repo.crear({ nombre: 'Barra cereal', p_venta: 2500, codigo_barras: '' });
    check('un segundo producto sin codigo NO choca por UNIQUE', c.ok,
          c.ok ? 'ok' : 'motivo=' + c.motivo);
    check('el codigo vacio se guardo como NULL', repo.obtenerPorId(c.id).codigo_barras === null);

    const dup = repo.crear({ nombre: 'Agua clon', p_venta: 3000, codigo_barras: '7702001' });
    check('un codigo repetido si se rechaza', !dup.ok && dup.motivo === 'codigo_duplicado',
          'motivo=' + dup.motivo);

    // --- busqueda por codigo ---
    check('obtenerPorCodigo encuentra', repo.obtenerPorCodigo('7702001').id === a.id);
    check('obtenerPorCodigo tolera espacios', repo.obtenerPorCodigo('  7702001 ').id === a.id);
    check('obtenerPorCodigo con vacio no devuelve nada', repo.obtenerPorCodigo('') === undefined);

    // --- movimientos de stock ---
    const entrada = repo.moverStock({ productoId: a.id, delta: 12, motivo: 'compra', usuarioId });
    check('entrada de stock suma', entrada.ok && entrada.stockNuevo === 36, 'stock=' + entrada.stockNuevo);

    const salida = repo.moverStock({ productoId: a.id, delta: -6, motivo: 'merma', usuarioId });
    check('salida de stock resta', salida.ok && salida.stockNuevo === 30, 'stock=' + salida.stockNuevo);

    const exceso = repo.moverStock({ productoId: a.id, delta: -999, motivo: 'error', usuarioId });
    check('no deja el stock en negativo', !exceso.ok && exceso.motivo === 'stock_insuficiente',
          'motivo=' + exceso.motivo);
    check('el rechazo no altero el stock', repo.obtenerPorId(a.id).stock === 30,
          'stock=' + repo.obtenerPorId(a.id).stock);

    const fantasma = repo.moverStock({ productoId: 9999, delta: 1, usuarioId });
    check('mover stock de un producto inexistente falla limpio',
          !fantasma.ok && fantasma.motivo === 'producto_no_existe');

    // --- rastro en auditoria ---
    const historial = repo.historialStock(a.id);
    check('cada movimiento aplicado dejo rastro', historial.length === 2, historial.length + ' registros');
    check('el rechazado NO dejo rastro', !historial.some(h => h.detalle.delta === -999));
    check('el rastro guarda el antes y el despues',
          historial.some(h => h.detalle.delta === 12 && h.detalle.stockAnterior === 24 && h.detalle.stockNuevo === 36));

    // --- editar no toca el stock ---
    const ed = repo.editar(a.id, { nombre: 'Agua 600ml', p_venta: 3500, p_costo: 1900, stock_min: 10, codigo_barras: '7702001' });
    check('editar devuelve ok', ed.ok);
    const editado = repo.obtenerPorId(a.id);
    check('el precio cambio', editado.p_venta === 3500);
    check('editar NO movio el stock', editado.stock === 30, 'stock=' + editado.stock);

    const edDup = repo.editar(b.id, { nombre: 'Proteina', p_venta: 8000, codigo_barras: '7702001' });
    check('editar hacia un codigo ya usado se rechaza',
          !edDup.ok && edDup.motivo === 'codigo_duplicado');

    // --- bajo minimo ---
    repo.moverStock({ productoId: a.id, delta: -21, motivo: 'ventas', usuarioId }); // queda 9, min 10
    repo.moverStock({ productoId: b.id, delta: 20, motivo: 'compra inicial', usuarioId }); // 20, min 0
    const bajos = repo.listarBajoMinimo();
    check('el producto bajo su minimo aparece', bajos.some(p => p.id === a.id),
          'stock=9 min=10');
    check('un producto con existencias sobre su minimo no aparece', !bajos.some(p => p.id === b.id),
          'stock=20 min=0');
    check('un producto agotado avisa aunque no tenga minimo configurado', bajos.some(p => p.id === c.id),
          'stock=0 min=0, es intencional');

    // --- activar / desactivar ---
    repo.desactivar(c.id);
    check('desactivado sale de listar', !repo.listar().some(p => p.id === c.id));
    check('desactivado sigue en listarTodos', repo.listarTodos().some(p => p.id === c.id));
    check('desactivado no aparece por codigo', repo.obtenerPorCodigo('7702001') !== undefined);
    repo.activar(c.id);
    check('reactivado vuelve a listar', repo.listar().some(p => p.id === c.id));

    conn.getDb().close();
  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallos === 0 ? 0 : 1);
});
