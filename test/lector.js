// Suite del lector de codigos de barras: el detector (que distingue el lector de
// una persona) y las entradas y salidas de mercancia.
//
// Lo que pasa DENTRO de la ventana -- que los digitos no se queden en el campo con
// foco, que el Kiosco ignore el escaneo -- lo prueba test/lector-ventana.js con
// pulsaciones de verdad.

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-lector-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-lector-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    // ------------------------------------------------------------- detector
    const { crearDetector, AJUSTES } = await import(
      pathToFileURL(path.join(__dirname, '..', 'src', 'lector', 'detector.mjs')).href);

    // Teclea `texto` con `paso` ms entre teclas, y un Enter `enter` ms despues.
    // Devuelve lo que contesta el detector al Enter.
    function teclear(det, texto, { paso = 5, enter = 5, desde = 1000, repetidas = false } = {}) {
      let t = desde;
      const respuestas = [];
      for (const k of texto) {
        respuestas.push(det.tecla(k, t, repetidas));
        t += paso;
      }
      const alEnter = det.tecla('Enter', t - paso + enter, false);
      return { alEnter, respuestas, fin: t - paso + enter };
    }

    let det = crearDetector();
    const escaneo = teclear(det, '7700304572069');
    check('un escaneo rapido es un codigo',
          escaneo.alEnter.tipo === 'codigo' && escaneo.alEnter.codigo === '7700304572069',
          JSON.stringify(escaneo.alEnter));
    check('el primer caracter abre la rafaga y los demas no',
          escaneo.respuestas[0].empieza === true && escaneo.respuestas.slice(1).every(r => r.empieza === false));

    det = crearDetector();
    check('una persona tecleando 1234 y Enter NO es un codigo',
          teclear(det, '1234', { paso: 120, enter: 150 }).alEnter.tipo === 'nada');

    det = crearDetector();
    check('una persona muy rapida (70 ms) tampoco',
          teclear(det, '12345678', { paso: 70, enter: 70 }).alEnter.tipo === 'nada');

    det = crearDetector();
    check('menos de ' + AJUSTES.MIN_LARGO + ' caracteres no es un codigo aunque sea rapido',
          teclear(det, '123').alEnter.tipo === 'nada');

    // Mantener una tecla pulsada la repite cada ~30 ms: tan rapido como el lector.
    det = crearDetector();
    det.tecla('1', 1000, false);
    for (let i = 1; i <= 8; i++) det.tecla('1', 1000 + i * 30, true);
    check('una tecla mantenida pulsada y luego Enter NO es un codigo',
          det.tecla('Enter', 1000 + 9 * 30, false).tipo === 'nada');

    // Code 39 / 128 con mayusculas: Shift entre letra y letra.
    det = crearDetector();
    let t = 2000;
    for (const k of ['Shift', 'A', 'Shift', 'B', '1', '2', '3']) { det.tecla(k, t, false); t += 4; }
    const conShift = det.tecla('Enter', t, false);
    check('un codigo con mayusculas (Shift en medio) se lee entero',
          conShift.tipo === 'codigo' && conShift.codigo === 'AB123', JSON.stringify(conShift));

    det = crearDetector();
    t = 3000;
    for (const k of ['7', '7', '0', 'Tab', '0', '3', '0', '4']) { det.tecla(k, t, false); t += 4; }
    const trasTab = det.tecla('Enter', t, false);
    check('una tecla que no escribe (Tab) corta la rafaga: lo de antes no entra en el codigo',
          trasTab.codigo === '0304', JSON.stringify(trasTab));

    det = crearDetector();
    check('un Enter que llega tarde no cierra un codigo',
          teclear(det, '77003045', { enter: AJUSTES.MAX_ANTES_DEL_ENTER_MS + 50 }).alEnter.tipo === 'nada');

    // Alguien escribe despacio y enseguida escanea: el codigo es solo lo rapido.
    det = crearDetector();
    det.tecla('9', 500, false);
    det.tecla('9', 700, false);
    const mezcla = teclear(det, '7700304572069', { desde: 900 });
    check('lo tecleado a mano antes del escaneo no se cuela en el codigo',
          mezcla.alEnter.codigo === '7700304572069', JSON.stringify(mezcla.alEnter));

    det = crearDetector();
    teclear(det, '7700304572069');
    check('despues de un codigo el detector queda limpio para el siguiente',
          teclear(det, '7702004003003', { desde: 5000 }).alEnter.codigo === '7702004003003');

    // ------------------------------------------------------ backend: stock
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();
    const repo = require('../electron/db/repos/productos');
    require('../electron/crypto/dek').guardarDekEnMemoria(require('../electron/crypto/dek').generarDEK());
    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Admin', 'admin', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;

    const agua = repo.crear({ nombre: 'Agua 600ml', p_venta: 3000, stock: 10, codigo_barras: '7702004003003' }).id;
    const barra = repo.crear({ nombre: 'Barra de proteina', p_venta: 8000, stock: 1, codigo_barras: '7700304572069' }).id;
    const viejo = repo.crear({ nombre: 'Producto viejo', p_venta: 1000, stock: 5, codigo_barras: '1111' }).id;
    repo.desactivar(viejo);

    const stock = (id) => db.prepare('SELECT stock FROM productos WHERE id = ?').get(id).stock;
    const movimientos = () => db.prepare("SELECT COUNT(*) n FROM auditoria WHERE accion = 'stock_movido'").get().n;

    check('buscarPorCodigo encuentra tambien los desactivados',
          repo.buscarPorCodigo('1111') && repo.buscarPorCodigo('1111').activo === 0);
    check('obtenerPorCodigo (el de vender) no los devuelve', repo.obtenerPorCodigo('1111') === undefined);
    check('buscarPorCodigo ignora espacios alrededor', repo.buscarPorCodigo('  7702004003003 ').id === agua);
    check('un codigo que no existe devuelve undefined', repo.buscarPorCodigo('0000000') === undefined);

    // Entrada: varias lineas, y el mismo producto en dos lineas se suma.
    const antes = movimientos();
    const entrada = repo.moverLote({
      tipo: 'entrada',
      items: [{ productoId: agua, cantidad: 12 }, { productoId: barra, cantidad: 24 }, { productoId: agua, cantidad: 3 }],
      nota: 'Factura 123', usuarioId,
    });
    check('una entrada suma a todos los productos',
          entrada.ok && stock(agua) === 25 && stock(barra) === 25, JSON.stringify({ agua: stock(agua), barra: stock(barra) }));
    check('el mismo producto en dos lineas es un solo movimiento',
          entrada.movimientos.length === 2 && movimientos() === antes + 2);
    check('y cuenta las unidades', entrada.unidades === 39);
    const detAgua = repo.historialStock(agua)[0].detalle;
    check('queda en auditoria con tipo, nota y lote',
          detAgua.tipo === 'entrada' && detAgua.nota === 'Factura 123' && detAgua.lote === entrada.lote && detAgua.delta === 15,
          JSON.stringify(detAgua));
    check('las dos lineas comparten el mismo lote',
          repo.historialStock(barra)[0].detalle.lote === entrada.lote);
    check('una entrada no pide motivo',
          repo.moverLote({ tipo: 'entrada', items: [{ productoId: agua, cantidad: 1 }], usuarioId }).ok && stock(agua) === 26);

    // Salida: motivo obligatorio y de la lista.
    const salidaBase = { tipo: 'salida', items: [{ productoId: agua, cantidad: 2 }], usuarioId };
    check('una salida sin motivo se rechaza',
          repo.moverLote({ ...salidaBase }).motivo === 'motivo_requerido' && stock(agua) === 26);
    check('una salida con un motivo que no es de la lista se rechaza',
          repo.moverLote({ ...salidaBase, motivo: 'se perdio' }).motivo === 'motivo_requerido' && stock(agua) === 26);
    check('"Otro" sin decir que paso se rechaza',
          repo.moverLote({ ...salidaBase, motivo: 'Otro', nota: '   ' }).motivo === 'nota_requerida' && stock(agua) === 26);

    const vencido = repo.moverLote({ ...salidaBase, motivo: 'Vencido' });
    check('una salida por Vencido resta', vencido.ok && stock(agua) === 24);
    check('y guarda la categoria para poder sumarla despues',
          repo.historialStock(agua)[0].detalle.categoria === 'Vencido' && repo.historialStock(agua)[0].detalle.delta === -2);

    const otro = repo.moverLote({ ...salidaBase, motivo: 'Otro', nota: 'Se regalo en un evento' });
    check('"Otro" con su explicacion pasa', otro.ok && repo.historialStock(agua)[0].detalle.nota === 'Se regalo en un evento');
    check('la lista de motivos es la acordada',
          JSON.stringify(repo.MOTIVOS_SALIDA) === JSON.stringify(['Vencido', 'Dañado', 'Consumo interno', 'Devolución a proveedor', 'Otro']));

    // Todo o nada.
    const aguaAntes = stock(agua);
    const barraAntes = stock(barra);
    const movAntes = movimientos();
    const aMedias = repo.moverLote({
      tipo: 'salida', motivo: 'Dañado', usuarioId,
      items: [{ productoId: agua, cantidad: 1 }, { productoId: barra, cantidad: barraAntes + 1 }],
    });
    check('si un producto no tiene suficientes, la salida entera se rechaza',
          aMedias.ok === false && aMedias.motivo === 'stock_insuficiente' && aMedias.nombre === 'Barra de proteina',
          JSON.stringify(aMedias));
    check('y no toca ni el producto que si tenia',
          stock(agua) === aguaAntes && stock(barra) === barraAntes && movimientos() === movAntes);

    // Dos lineas del mismo producto que por separado caben y juntas no.
    const partido = repo.moverLote({
      tipo: 'salida', motivo: 'Consumo interno', usuarioId,
      items: [{ productoId: barra, cantidad: barraAntes }, { productoId: barra, cantidad: 1 }],
    });
    check('partir una salida en dos lineas no permite pasarse del stock',
          partido.motivo === 'stock_insuficiente' && stock(barra) === barraAntes);

    for (const mala of [0, -3, 1.5, 'abc', null, 100000, 37700304572069]) {
      const r = repo.moverLote({ tipo: 'entrada', items: [{ productoId: agua, cantidad: mala }], usuarioId });
      check('rechaza la cantidad ' + JSON.stringify(mala), r.motivo === 'cantidad_invalida');
    }
    const tope = repo.moverLote({ tipo: 'entrada', items: [{ productoId: agua, cantidad: repo.MAX_CANTIDAD_POR_LINEA }], usuarioId });
    check('el tope exacto (99.999) si se acepta', tope.ok === true);
    repo.moverLote({ tipo: 'salida', motivo: 'Otro', nota: 'deshacer prueba de tope', items: [{ productoId: agua, cantidad: repo.MAX_CANTIDAD_POR_LINEA }], usuarioId });
    check('no mueve stock a un producto desactivado',
          repo.moverLote({ tipo: 'entrada', items: [{ productoId: viejo, cantidad: 1 }], usuarioId }).motivo === 'producto_inactivo');
    check('ni a uno que no existe',
          repo.moverLote({ tipo: 'entrada', items: [{ productoId: 99999, cantidad: 1 }], usuarioId }).motivo === 'producto_no_existe');
    check('una lista vacia se rechaza', repo.moverLote({ tipo: 'entrada', items: [], usuarioId }).motivo === 'sin_productos');
    check('un tipo raro se rechaza', repo.moverLote({ tipo: 'regalo', items: [{ productoId: agua, cantidad: 1 }], usuarioId }).motivo === 'tipo_invalido');

    // El canal de la pantalla es este y no el viejo ajustarStock, que dejaba
    // salidas sin motivo.
    const handlers = {};
    const { ipcMain } = require('electron');
    const orig = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (c, fn) => { handlers[c] = fn; orig(c, fn); };
    require('../electron/ipc/productos');
    check('ya no existe el canal ajustarStock', !handlers['productos:ajustarStock']);
    check('el canal moverLote exige el motivo igual que el repo',
          (await handlers['productos:moverLote'](null, { ...salidaBase })).motivo === 'motivo_requerido');

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
