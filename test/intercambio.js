const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-intercambio-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-intercambio-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const ExcelJS = require('exceljs');
    const { format, subDays } = require('date-fns');
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();
    const inter = require('../electron/services/intercambio');
    const membresias = require('../electron/db/repos/membresias');
    const planes = require('../electron/db/repos/planes');
    const clientes = require('../electron/db/repos/clientes');
    const caja = require('../electron/db/repos/caja');

    const hace = (n) => format(subDays(new Date(), n), 'yyyy-MM-dd');
    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Cajero', 'cajero', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;

    // ------------------------------------------------------------- exportar
    const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 70000, dias_duracion: 30 });
    const bono = planes.crear({ nombre: 'Bono 10', tipo: 'ticketera', precio: 90000, num_tickets: 10, dias_vigencia: 60 });
    caja.abrir({ usuarioId, baseInicial: 100000 });

    const ana = clientes.crear({ documento: '1020304050', nombre: 'Ana María Torres Ríos',
                                 telefono: '3115557788', email: 'ana@mail.com', f_nacimiento: '1992-05-10' });
    const mAna = membresias.vender({ clienteId: ana, planId: mensual, usuarioId, fInicio: hace(10) });
    membresias.registrarPago({ membresiaId: mAna, monto: 50000, metodo: 'Nequi', usuarioId });

    const beto = clientes.crear({ documento: '9988776655', nombre: 'Beto Rojas', telefono: '3001112233' });
    const mBeto = membresias.vender({ clienteId: beto, planId: bono, usuarioId, fInicio: hace(5) });
    membresias.registrarPago({ membresiaId: mBeto, monto: 90000, metodo: 'Efectivo', usuarioId });
    db.prepare(`UPDATE membresias SET tickets_usados = 4 WHERE id = ?`).run(mBeto);

    clientes.crear({ documento: '5555', nombre: 'Elsa Sin Membresia', telefono: '3009998877' });

    const rutaXlsx = path.join(testDir, 'export.xlsx');
    const exp = await inter.exportarExcel(rutaXlsx);
    check('exporta a Excel', exp.ok === true && fs.existsSync(rutaXlsx));
    check('una fila por membresia, y una por el cliente que no tiene ninguna',
          exp.filas === 3, 'filas=' + exp.filas);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(rutaXlsx);
    const ws = wb.getWorksheet('Clientes');
    const cabecera = ws.getRow(1).values.slice(1).map(v => String(v).trim());
    check('el archivo lleva la columna Documento que el original no tenia',
          cabecera[0] === 'Documento', cabecera[0]);
    check('y las 14 columnas del archivo de Andrey, en su orden',
          cabecera.slice(1).join('|') ===
          'Nombres|Apellidos|Telefono|Correo|Nacimiento|Fecha inicio|Fecha final|Dias|Estado|Total pago|Saldo Restante|Metodo de pago|Tipo Membresia|Tiquetes Usados',
          cabecera.slice(1).join('|'));
    check('el PIN no viaja en el archivo',
          !cabecera.some(c => /pin/i.test(c)), cabecera.join('|'));

    const filaAna = inter.filasParaExportar().find(f => f.documento === '1020304050');
    check('"Total pago" es lo abonado', filaAna.totalPago === 50000, 'totalPago=' + filaAna.totalPago);
    check('y "Saldo Restante" lo que falta', filaAna.saldoRestante === 20000, 'saldo=' + filaAna.saldoRestante);
    check('los dos juntos dan el precio del plan',
          filaAna.totalPago + filaAna.saldoRestante === 70000);
    check('el nombre se parte en Nombres y Apellidos',
          filaAna.nombres === 'Ana María' && filaAna.apellidos === 'Torres Ríos',
          filaAna.nombres + ' / ' + filaAna.apellidos);

    const filaBeto = inter.filasParaExportar().find(f => f.documento === '9988776655');
    check('las ticketeras exportan sus tiquetes usados', filaBeto.tiquetesUsados === 4);

    // -------------------------------------------------- ida y vuelta de verdad
    // Se importa lo exportado sobre una base nueva y se comparan las filas: si
    // el formato pierde algo por el camino, aqui se ve.
    const otroDir = path.join(os.tmpdir(), 'gymapp-test-inter-2-' + Date.now());
    fs.mkdirSync(otroDir, { recursive: true });
    const antes = JSON.stringify(inter.filasParaExportar());

    // El archivo lleva clientes y membresias, no el catalogo de planes. Se
    // vacia lo que el archivo si sabe reconstruir.
    db.prepare(`DELETE FROM pagos`).run();
    db.prepare(`DELETE FROM membresias`).run();
    db.prepare(`DELETE FROM clientes`).run();

    const imp = await inter.importarExcel(rutaXlsx, { usuarioId });
    check('importa sin errores', imp.ok && imp.errores.length === 0,
          'errores=' + JSON.stringify(imp.errores));
    check('crea los tres clientes', imp.clientesCreados === 3, 'creados=' + imp.clientesCreados);
    check('crea las dos membresias', imp.membresiasCreadas === 2, 'membresias=' + imp.membresiasCreadas);
    check('reutiliza los planes que ya estaban, no los duplica',
          imp.planesCreados === 0, 'planes creados=' + imp.planesCreados);

    const despues = JSON.stringify(inter.filasParaExportar());
    if (antes !== despues) {
      const a = JSON.parse(antes), d = JSON.parse(despues);
      for (let i = 0; i < Math.max(a.length, d.length); i++) {
        for (const k of Object.keys(a[i] || d[i] || {})) {
          if (JSON.stringify((a[i]||{})[k]) !== JSON.stringify((d[i]||{})[k])) {
            log('  DIFERENCIA fila ' + i + ' campo ' + k + ': ' +
                JSON.stringify((a[i]||{})[k]) + ' -> ' + JSON.stringify((d[i]||{})[k]));
          }
        }
      }
    }
    check('lo exportado y lo reimportado son lo mismo, fila por fila', antes === despues);

    // --------------------------------------------- reimportar no duplica nada
    const dosVeces = await inter.importarExcel(rutaXlsx, { usuarioId });
    check('reimportar el mismo archivo no crea clientes de nuevo',
          dosVeces.clientesCreados === 0 && dosVeces.clientesActualizados === 3,
          'creados=' + dosVeces.clientesCreados);
    check('ni duplica las membresias',
          dosVeces.membresiasCreadas === 0 && dosVeces.membresiasOmitidas === 2,
          'creadas=' + dosVeces.membresiasCreadas + ' omitidas=' + dosVeces.membresiasOmitidas);
    check('la base queda igual que antes de reimportar',
          JSON.stringify(inter.filasParaExportar()) === despues);

    // ------------------------------------- importar no toca el arqueo de caja
    const cajaAntes = caja.resumen(caja.sesionAbierta().id).esperado;
    await inter.importarExcel(rutaXlsx, { usuarioId });
    check('importar no mete el dinero viejo en la caja de hoy',
          caja.resumen(caja.sesionAbierta().id).esperado === cajaAntes,
          cajaAntes + ' -> ' + caja.resumen(caja.sesionAbierta().id).esperado);

    // ------------------------------------------------------------- el archivo real
    const real = 'F:/gymapp V2/Membresias GYM - 50 clientes actualizado.xlsx';
    if (fs.existsSync(real)) {
      const lectura = await inter.leerFilas(real);
      check('el archivo real de Andrey se lee', lectura.ok === true, 'motivo=' + lectura.motivo);
      if (lectura.ok) {
        // 49 clientes reales, filas 2 a 50. La 51 solo tiene "Activo" y un 0
        // sueltos, y el resto de la hoja son mil filas vacias: todo eso se salta.
        check('lee los 49 clientes y descarta el resto de la hoja',
              lectura.filas.length === 49, 'filas=' + lectura.filas.length);
        const santiago = lectura.filas[0];
        check('lee bien los nombres con tilde',
              lectura.filas.some(f => f.nombre.includes('Andrés')),
              'primero=' + santiago.nombre);
        check('lee bien las fechas', santiago.fInicio === '2026-08-24', 'inicio=' + santiago.fInicio);
        check('lee bien los importes',
              santiago.totalPago === 60000 && santiago.saldoRestante === 10000,
              santiago.totalPago + '/' + santiago.saldoRestante);
        check('y avisa de que a ese archivo le falta el documento',
              lectura.filas.every(f => !f.documento));

        const conReal = await inter.importarExcel(real, { usuarioId });
        check('el archivo viejo se rechaza entero por no traer Documento',
              conReal.ok === false && conReal.motivo === 'falta_columna_documento',
              'motivo=' + conReal.motivo);
        check('y no crea ni un solo cliente a ciegas',
              !db.prepare(`SELECT 1 FROM clientes WHERE documento IS NULL`).get());
      }
    } else {
      log('  (el archivo real no está en su sitio, se omite esa parte)');
    }

    // --------------------------------------------------------- filas con problemas
    const rutaSucio = path.join(testDir, 'sucio.xlsx');
    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('Clientes');
    ws2.addRow(inter.COLUMNAS.map(c => c.titulo));
    ws2.addRow(['', 'Nadie', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    ws2.addRow(['777', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    ws2.addRow(['888', 'Con', 'Membresia', '', '', '', '', '', '', '', '', '', '', 'Mensual', '']);
    ws2.addRow(['999', 'Bien', 'Puesto', '3001234567', '', '', '', '', '', '', '', '', '', '', '']);
    await wb2.xlsx.writeFile(rutaSucio);

    const sucio = await inter.importarExcel(rutaSucio, { usuarioId });
    // Cambio del 07-sep-2026: una fila sin documento ya NO se rechaza. Entra con
    // una cedula provisional 1234xxxx y queda marcada. Ver test/documento-provisional.js.
    check('una fila sin documento ya no se rechaza: entra con cedula provisional',
          !sucio.errores.some(e => e.motivo === 'sin documento') && sucio.provisionales === 1,
          'provisionales=' + sucio.provisionales);
    check('una fila sin nombre se rechaza',
          sucio.errores.some(e => e.motivo === 'sin nombre'));
    check('una membresia sin fecha de inicio se rechaza',
          sucio.errores.some(e => e.motivo.includes('fecha de inicio')));
    check('la fila buena entra, y con ella la que no traia documento',
          sucio.clientesCreados === 2, 'creados=' + sucio.clientesCreados);
    check('y ninguna fila mala deja cliente a medias',
          !db.prepare(`SELECT 1 FROM clientes WHERE documento IN ('777','888')`).get());

    // ------------------------------------------------- columnas que no estan
    const rutaOtro = path.join(testDir, 'otro.xlsx');
    const wb3 = new ExcelJS.Workbook();
    const ws3 = wb3.addWorksheet('Clientes');
    ws3.addRow(['Cosa', 'Otra cosa']);
    ws3.addRow(['a', 'b']);
    await wb3.xlsx.writeFile(rutaOtro);
    const otro = await inter.importarExcel(rutaOtro, { usuarioId });
    check('un archivo que no es el formato se rechaza entero, no a medias',
          otro.ok === false && otro.motivo === 'faltan_columnas', JSON.stringify(otro.faltan));

    // ------------------------- un plan que no esta en el catalogo se inventa
    const rutaPlan = path.join(testDir, 'plan-nuevo.xlsx');
    const wb4 = new ExcelJS.Workbook();
    const ws4 = wb4.addWorksheet('Clientes');
    ws4.addRow(inter.COLUMNAS.map(c => c.titulo));
    ws4.addRow(['4444', 'Nuevo', 'Cliente', '3001112222', '', '', hace(3), '', '', '',
                65000, 0, 'Efectivo', 'Tiquetera para 1 mes de 15 tiquetes', 5]);
    ws4.addRow(['3333', 'Otro', 'Cliente', '3001113333', '', '', hace(3), '', '', '',
                50000, 0, 'Efectivo', 'Plan sin nombre claro', 3]);
    await wb4.xlsx.writeFile(rutaPlan);

    const conPlanes = await inter.importarExcel(rutaPlan, { usuarioId });
    check('crea el plan que no estaba en el catalogo', conPlanes.planesCreados === 2,
          'planes=' + conPlanes.planesCreados);
    const tiquetera = db.prepare(`SELECT * FROM planes WHERE nombre LIKE 'Tiquetera%'`).get();
    check('lee del nombre cuantos tiquetes traia la ticketera',
          tiquetera.tipo === 'ticketera' && tiquetera.num_tickets === 15,
          tiquetera.tipo + '/' + tiquetera.num_tickets);
    check('y guarda los que ya se habian gastado',
          db.prepare(`SELECT tickets_usados FROM membresias WHERE plan_id = ?`).get(tiquetera.id)
            .tickets_usados === 5);

    const aOjo = db.prepare(`SELECT * FROM planes WHERE nombre = 'Plan sin nombre claro'`).get();
    check('si el nombre no lo dice, deduce que es ticketera porque se gastaron tiquetes',
          aOjo.tipo === 'ticketera', aOjo.tipo);
    check('y avisa de que ese plan hay que revisarlo a mano',
          conPlanes.avisos.some(a => a.plan === 'Plan sin nombre claro'),
          JSON.stringify(conPlanes.avisos));

    // --------------------- columna Documento presente pero sin rellenar
    const rutaVacia = path.join(testDir, 'sin-cedulas.xlsx');
    const wb5 = new ExcelJS.Workbook();
    const ws5 = wb5.addWorksheet('Clientes');
    ws5.addRow(inter.COLUMNAS.map(c => c.titulo));
    ws5.addRow(['', 'Santiago', 'Torres', '3245761895', '', '', hace(3), '', '', '',
                60000, 10000, 'Efectivo', 'Mensual', 0]);
    ws5.addRow(['', 'Andrés', 'Rojas', '3605274960', '', '', hace(3), '', '', '',
                65000, 0, 'Nequi', 'Mensual', 0]);
    await wb5.xlsx.writeFile(rutaVacia);

    const vacia = await inter.importarExcel(rutaVacia, { usuarioId });
    check('un archivo con la columna Documento entera vacia ya se importa',
          vacia.ok === true && vacia.clientesCreados === 2,
          'creados=' + vacia.clientesCreados);
    check('y esos clientes existen, con su cedula provisional',
          db.prepare(`SELECT documento_provisional FROM clientes WHERE nombre = 'Santiago Torres'`)
            .get().documento_provisional === 1);

    // La fecha de fin no venia en el archivo: se deduce del plan, o esas
    // membresias no venceria nunca.
    const santiago = db.prepare(`SELECT id FROM clientes WHERE nombre = 'Santiago Torres'`).get();
    check('a una membresia sin fecha de fin se le calcula con los dias del plan',
          !!db.prepare(`SELECT f_fin FROM membresias WHERE cliente_id = ?`).get(santiago.id).f_fin);

    // ------------------------------------------------------------------ JSON
    const rutaJson = path.join(testDir, 'export.json');
    const expJson = inter.exportarJson(rutaJson);
    check('tambien exporta a JSON', expJson.ok && fs.existsSync(rutaJson));
    const leido = JSON.parse(fs.readFileSync(rutaJson, 'utf-8'));
    check('el JSON lleva las mismas columnas que el Excel',
          leido.columnas.length === inter.COLUMNAS.length && leido.filas.length === expJson.filas);

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
