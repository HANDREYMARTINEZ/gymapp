// Ensayo de la operación de los correos reales (fase 1.1 del plan de cierre).
//
// No es una suite de unidades: es un simulacro de lo que Andrey va a hacer una
// sola vez sobre la base de verdad, hecho sobre una base de mentira que
// reproduce la suya -- 117 clientes, la mayoría con direcciones @example.com
// inventadas por la importación, muchas con tildes, cédulas provisionales, y un
// catálogo de planes con la misma suciedad heredada del Excel: nombres con
// espacio al final y dos planes distintos llamados "Dia".
//
// El paso que aquí NO se puede reproducir es abrir el archivo en Excel de
// verdad y volver a guardarlo: en esta máquina no hay Excel. Lo que sí se
// reproduce es el DAÑO que Excel le hace al archivo al guardarlo, que es lo que
// importa: las fechas dejan de ser texto y pasan a ser fechas, y los importes
// dejan de ser texto y pasan a ser números. Si la reimportación aguanta eso,
// aguanta el archivo que salga de Excel.
//
// Se ejecuta con: npm run test:ensayo-correos

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { format, addDays, subDays } = require('date-fns');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-ensayo-correos-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-ensayo-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const dia = (n) => format(addDays(new Date(), n), 'yyyy-MM-dd');
const hace = (n) => format(subDays(new Date(), n), 'yyyy-MM-dd');

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const ExcelJS = require('exceljs');
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();

    const planes = require('../electron/db/repos/planes');
    const clientes = require('../electron/db/repos/clientes');
    const membresias = require('../electron/db/repos/membresias');
    const caja = require('../electron/db/repos/caja');
    const inter = require('../electron/services/intercambio');
    const recordatorios = require('../electron/services/recordatorios');

    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Recepcion', 'recepcion', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;
    caja.abrir({ usuarioId, baseInicial: 0 });

    // ------------------------------------------------- la base de mentira
    // El catálogo, con la suciedad real: espacios al final y dos "Dia".
    const catalogo = {
      mensual: planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 70000, dias_duracion: 30 }),
      diaConEspacio: planes.crear({ nombre: 'Dia ', tipo: 'periodo', precio: 8000, dias_duracion: 1 }),
      dia: planes.crear({ nombre: 'Dia', tipo: 'periodo', precio: 10000, dias_duracion: 1 }),
      anualConEspacio: planes.crear({ nombre: 'Anual ', tipo: 'periodo', precio: 600000, dias_duracion: 365 }),
      bono: planes.crear({ nombre: 'Bono 10 tiquetes', tipo: 'ticketera', precio: 90000, num_tickets: 10, dias_vigencia: 60 }),
    };
    const planesDeLaBase = Object.values(catalogo);

    // 117 clientes, repartidos como los suyos:
    //   72 con correo @example.com Y tildes (los dos problemas a la vez)
    //   37 con correo @example.com limpio
    //    5 sin correo ninguno
    //    3 con correo de verdad
    const NOMBRES = ['Andrés Ríos', 'Sofía Torres', 'Camilo Peña', 'Valentina Muñoz', 'Julián Cortés'];
    const creados = [];
    for (let i = 0; i < 117; i++) {
      let email = null;
      if (i < 72) email = 'josé.pérez' + i + '@example.com';
      else if (i < 109) email = 'cliente' + i + '@example.com';
      else if (i < 114) email = null;
      else email = 'real' + i + '@gmail.com';

      // Uno de cada quince entró sin cédula: el repositorio le pone una
      // provisional 1234xxxx, igual que hizo la importación de verdad.
      const conCedula = i % 15 !== 0;
      const id = clientes.crear({
        documento: conCedula ? String(30000000 + i) : '',
        nombre: NOMBRES[i % NOMBRES.length] + ' ' + i,
        telefono: '300' + String(1000000 + i),
        email,
      });

      // Vencidas, por vencer y al día: las tres respuestas de la ronda.
      const planId = planesDeLaBase[i % planesDeLaBase.length];
      const mId = membresias.vender({ clienteId: id, planId, usuarioId, fInicio: hace(40) });
      // Se paga el plan entero. Quien debe dinero queda en 'saldo_pendiente', que
      // gana sobre la fecha y NO recibe recordatorio -- es a propósito, pero aquí
      // taparía lo que se quiere medir, que es el efecto de los correos.
      membresias.registrarPago({ membresiaId: mId, monto: planes.obtenerPorId(planId).precio,
                                 metodo: 'Efectivo', usuarioId });
      // Los tres que hoy tienen correo de verdad están al día, como los suyos:
      // por eso la ronda de hoy no le llega absolutamente a nadie.
      const fFin = i >= 114 ? dia(20)
                 : (i % 3 === 0 ? dia(-7) : (i % 3 === 1 ? dia(4) : dia(20)));
      db.prepare('UPDATE membresias SET f_fin = ? WHERE id = ?').run(fFin, mId);
      creados.push({ id, email });
    }

    const contar = (tabla) => db.prepare('SELECT COUNT(*) AS n FROM ' + tabla).get().n;

    // ------------------------------------------------- 1. el censo de hoy
    const antes = recordatorios.censoCorreos();
    check('el censo ve a los 117 clientes activos', antes.total === 117, 'total=' + antes.total);
    check('y dice que hoy solo se le puede escribir a 3',
          antes.utilizables === 3 && antes.porConseguir === 114,
          'utilizables=' + antes.utilizables + ' faltan=' + antes.porConseguir);
    check('con las tildes contadas aparte del dominio de ejemplo',
          antes.con_tildes.length === 72 && antes.dominio_de_ejemplo.length === 37 &&
          antes.vacio.length === 5,
          [antes.con_tildes.length, antes.dominio_de_ejemplo.length, antes.vacio.length].join('/'));

    const rondaAntes = recordatorios.destinatarios({ incluyePorVencer: true, cadaDias: 15 });
    check('y por eso hoy la ronda no le llegaría a NADIE',
          rondaAntes.porEnviar.length === 0,
          'porEnviar=' + rondaAntes.porEnviar.length +
          ' invalidos=' + rondaAntes.correoInvalido.length +
          ' sinCorreo=' + rondaAntes.sinCorreo.length);

    // ------------------------------------------------- 2. exportar la hoja
    const ruta = path.join(testDir, 'clientes.xlsx');
    const exp = await inter.exportarExcel(ruta);
    check('exporta una fila por membresía', exp.filas === 117, 'filas=' + exp.filas);

    // ------------------------- 3. el ensayo de UN SOLO correo (por olas)
    // Esto es lo que permite hacer la primera prueba de verdad sin arriesgar una
    // tanda de setenta correos: rellenar UNA sola celda -- la del propio Andrey,
    // puesta encima de un cliente vencido -- y dejar a los demás con su
    // @example.com. Como las direcciones de ejemplo se apartan antes de enviar,
    // la ronda queda con exactamente una persona dentro y "Enviar ahora" manda
    // un único correo. Sin pantallas nuevas y sin nada que pueda escapársele a
    // un cliente real.
    {
      const rutaUna = path.join(testDir, 'una-sola.xlsx');
      await inter.exportarExcel(rutaUna);
      const wbU = new ExcelJS.Workbook();
      await wbU.xlsx.readFile(rutaUna);
      const wsU = wbU.getWorksheet('Clientes');
      const colU = (clave) => inter.COLUMNAS.findIndex(c => c.clave === clave) + 1;

      let filaElegida = null;
      for (let n = 2; n <= wsU.rowCount && !filaElegida; n++) {
        if (String(wsU.getRow(n).getCell(colU('estado')).value || '').trim() === 'Vencido') filaElegida = n;
      }
      wsU.getRow(filaElegida).getCell(colU('correo')).value = 'andrey@gmail.com';
      const documentoElegido = String(wsU.getRow(filaElegida).getCell(colU('documento')).value).trim();
      await wbU.xlsx.writeFile(rutaUna);

      const pagosPrevios = contar('pagos');
      const memPrevias = contar('membresias');
      const una = await inter.importarExcel(rutaUna, { usuarioId });
      check('rellenar una sola celda no crea nada, igual que rellenarlas todas',
            una.clientesCreados === 0 && una.membresiasCreadas === 0 &&
            contar('pagos') === pagosPrevios && contar('membresias') === memPrevias,
            'creados=' + una.clientesCreados + ' membresias=' + una.membresiasCreadas +
            ' pagos ' + pagosPrevios + ' -> ' + contar('pagos'));

      const rondaUna = recordatorios.destinatarios({ incluyePorVencer: true, cadaDias: 15 });
      check('y la ronda queda con UNA sola persona dentro: los @example.com se apartan solos',
            rondaUna.porEnviar.length === 1 && rondaUna.porEnviar[0].email === 'andrey@gmail.com',
            'porEnviar=' + rondaUna.porEnviar.length +
            ' -> ' + JSON.stringify(rondaUna.porEnviar.map(d => d.email)));
      check('es el cliente de esa fila, con su plan y su fecha de verdad',
            db.prepare('SELECT id FROM clientes WHERE documento = ?').get(documentoElegido).id
              === rondaUna.porEnviar[0].clienteId &&
            rondaUna.porEnviar[0].tipo === 'vencida',
            'tipo=' + rondaUna.porEnviar[0].tipo);
    }

    // -------------------------- 4. rellenar los correos Y estropear el archivo
    // como lo estropearía Excel al guardarlo: fechas que dejan de ser texto,
    // importes que dejan de ser texto. Es lo único de este ensayo que no se
    // puede comprobar de otra forma en esta máquina, donde no hay Excel.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ruta);
    const ws = wb.getWorksheet('Clientes');
    const col = (clave) => inter.COLUMNAS.findIndex(c => c.clave === clave) + 1;

    let rellenadas = 0;
    for (let n = 2; n <= ws.rowCount; n++) {
      const fila = ws.getRow(n);

      // Lo que hace Andrey: escribir el correo. Una fila se deja a propósito sin
      // tocar, para comprobar que una celda vacía no borra lo que ya había.
      if (n > 2) { fila.getCell(col('correo')).value = 'cliente' + n + '@gmail.com'; rellenadas++; }

      // Lo que hace Excel sin preguntar.
      for (const clave of ['nacimiento', 'fInicio', 'fFin']) {
        const celda = fila.getCell(col(clave));
        const texto = String(celda.value == null ? '' : celda.value).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) celda.value = new Date(texto + 'T00:00:00.000Z');
      }
      for (const clave of ['totalPago', 'saldoRestante', 'tiquetesUsados']) {
        const celda = fila.getCell(col(clave));
        const texto = String(celda.value == null ? '' : celda.value).trim();
        if (texto !== '') celda.value = Number(texto);
      }
    }
    await wb.xlsx.writeFile(ruta);
    check('se rellenan 116 correos y se deja uno sin tocar', rellenadas === 116, 'rellenadas=' + rellenadas);

    // ------------------------------------ 4. la vista previa antes de importar
    const lectura = await inter.leerFilas(ruta);
    check('el archivo estropeado por Excel se sigue leyendo entero',
          lectura.ok === true && lectura.filas.length === 117,
          'filas=' + (lectura.filas || []).length);
    check('y las fechas sobreviven al viaje por Excel sin correrse un día',
          lectura.filas.every(f => f.fInicio === hace(40)),
          'primera=' + lectura.filas[0].fInicio + ' esperada=' + hace(40));

    let nuevos = 0, existentes = 0;
    for (const f of lectura.filas) {
      if (db.prepare('SELECT 1 FROM clientes WHERE documento = ?').get(f.documento)) existentes++;
      else nuevos++;
    }
    check('la vista previa avisa de 117 que se actualizan y 0 nuevos',
          existentes === 117 && nuevos === 0, existentes + ' existentes / ' + nuevos + ' nuevos');

    // ------------------------------------------------------- 5. reimportar
    const memAntes = contar('membresias');
    const pagosAntes = contar('pagos');
    const planesAntes = contar('planes');
    const cajaAntes = caja.resumen(caja.sesionAbierta().id).esperado;

    const r = await inter.importarExcel(ruta, { usuarioId });
    check('la importación no falla ni deja filas fuera',
          r.ok === true && r.errores.length === 0, JSON.stringify(r.errores.slice(0, 3)));
    check('no crea ni un cliente: los 117 se actualizan',
          r.clientesCreados === 0 && r.clientesActualizados === 117,
          'creados=' + r.clientesCreados + ' actualizados=' + r.clientesActualizados);
    check('no crea ni una membresía, ni siquiera con los planes "Dia " y "Anual "',
          r.membresiasCreadas === 0 && contar('membresias') === memAntes,
          'creadas=' + r.membresiasCreadas + ' total=' + contar('membresias'));
    check('no vuelve a apuntar ni un pago',
          contar('pagos') === pagosAntes, pagosAntes + ' -> ' + contar('pagos'));
    check('no inventa planes gemelos del catálogo sucio',
          contar('planes') === planesAntes && r.planesCreados === 0,
          planesAntes + ' -> ' + contar('planes'));
    check('y no mete el dinero viejo en la caja de hoy',
          caja.resumen(caja.sesionAbierta().id).esperado === cajaAntes);
    check('las cédulas provisionales se reconocen por su 1234xxxx y no se duplican',
          db.prepare('SELECT COUNT(*) AS n FROM clientes WHERE documento_provisional = 1').get().n === 8,
          'provisionales=' + db.prepare('SELECT COUNT(*) AS n FROM clientes WHERE documento_provisional = 1').get().n);

    // ------------------------------------------------- 6. el censo después
    const despues = recordatorios.censoCorreos();
    check('ahora se le puede escribir a 116 de los 117',
          despues.utilizables === 116 && despues.porConseguir === 1,
          'utilizables=' + despues.utilizables + ' faltan=' + despues.porConseguir);
    check('el único que falta es el de la fila que se dejó sin tocar, y conserva el correo que tenía',
          despues.con_tildes.length === 1 && despues.con_tildes[0].email.includes('@example.com'),
          JSON.stringify(despues.con_tildes.map(c => c.email)));

    const rondaDespues = recordatorios.destinatarios({ incluyePorVencer: true, cadaDias: 15 });
    // Cuántos DEBERÍAN recibir, contado aparte y por otro camino: quien tiene la
    // membresía vencida, agotada o por vencer. Atarlo al dato y no a un número
    // escrito a mano es lo que hace que este ensayo siga diciendo la verdad si
    // mañana se cambia el reparto de fechas de arriba.
    const { cargarEstados } = require('../electron/db/repos/panel-clientes');
    const { elegirMembresiaGobernante } = require('../electron/services/membresias-logica');
    const mapaEstados = cargarEstados();
    const cuentaEstados = {};
    for (const c of db.prepare('SELECT id FROM clientes WHERE activo = 1').all()) {
      const g = elegirMembresiaGobernante(mapaEstados.get(c.id) || []);
      const k = g ? g.estado : 'sin membresia';
      cuentaEstados[k] = (cuentaEstados[k] || 0) + 1;
    }
    const elegibles = (cuentaEstados.vencida || 0) + (cuentaEstados.agotada || 0) +
                      (cuentaEstados.por_vencer || 0);
    log('  estados de la base -> ' + JSON.stringify(cuentaEstados) + ' | elegibles=' + elegibles);
    check('y la ronda pasa de 0 personas a TODAS las elegibles menos la fila que no se tocó',
          rondaDespues.porEnviar.length === elegibles - 1 &&
          rondaDespues.correoInvalido.length === 1 &&
          rondaDespues.sinCorreo.length === 0,
          'porEnviar=' + rondaDespues.porEnviar.length + ' elegibles=' + elegibles +
          ' invalidos=' + rondaDespues.correoInvalido.length +
          ' sinCorreo=' + rondaDespues.sinCorreo.length);
    check('los que están al día siguen sin recibir nada',
          rondaDespues.porEnviar.every(d => d.tipo === 'vencida' || d.tipo === 'por_vencer'));

    // ------------------------------- 7. las dos formas de estropear la hoja
    // Borrar filas del Excel NO borra clientes: importar solo añade y actualiza.
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile(ruta);
    const ws2 = wb2.getWorksheet('Clientes');
    ws2.spliceRows(2, 100);
    const rutaCorta = path.join(testDir, 'a-la-mitad.xlsx');
    await wb2.xlsx.writeFile(rutaCorta);

    const corta = await inter.importarExcel(rutaCorta, { usuarioId });
    check('borrar 100 filas del Excel no borra a nadie de la base',
          corta.ok === true && contar('clientes') === 117,
          'clientes=' + contar('clientes'));
    check('ni toca las membresías de los que desaparecieron de la hoja',
          contar('membresias') === memAntes);

    // Reimportar la misma hoja una tercera vez tampoco mueve nada: es lo que
    // pasa si alguien vuelve a darle al botón por no acordarse.
    const otraVez = await inter.importarExcel(ruta, { usuarioId });
    check('volver a importar la hoja por tercera vez no cambia nada',
          otraVez.membresiasCreadas === 0 && contar('membresias') === memAntes &&
          contar('pagos') === pagosAntes && contar('clientes') === 117);

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
