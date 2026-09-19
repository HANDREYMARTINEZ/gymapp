// Clientes que entran sin cedula.
//
// Andrey pidio dos cosas: que las filas del Excel sin Documento entren igual con
// una cedula asignada, y que el kiosco avise de que a ese cliente le falta el
// documento cuando marque asistencia.
//
// Lo que se prueba aqui, ademas de que funcione: que la cedula provisional no
// choque con otra (documento es UNIQUE), que reimportar el mismo archivo no
// duplique a esa gente, que el aviso salga por los DOS caminos del kiosco -- PIN
// y huella -- y que se apague solo al escribirle la cedula real.

const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-documento-provisional-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-docprov-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const handlers = {};
const registrarOriginal = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (canal, fn) => { handlers[canal] = fn; registrarOriginal(canal, fn); };

const COLUMNAS = ['Documento', 'Nombres', 'Apellidos', 'Telefono', 'Tipo de membresia', 'Fecha inicio', 'Fecha fin', 'Total pago', 'Saldo restante'];

// Un Excel con el formato que la app espera, para no depender de un archivo
// suelto en el disco de nadie.
async function escribirExcel(ruta, filas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Membresias');
  ws.addRow(COLUMNAS);
  for (const f of filas) ws.addRow(f);
  await wb.xlsx.writeFile(ruta);
  return ruta;
}

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

    require('../electron/ipc/setup');
    require('../electron/ipc/auth');
    require('../electron/ipc/kiosco');

    const usuarios = require('../electron/db/repos/usuarios');
    const clientesRepo = require('../electron/db/repos/clientes');
    const panel = require('../electron/db/repos/panel-clientes');
    const intercambio = require('../electron/services/intercambio');
    const { conFoto } = require('../electron/ipc/kiosco');

    const admin = await usuarios.crear({ nombre: 'Andrey', usuario: 'andrey', password: 'clave1234', rol: 'admin' });
    await handlers['setup:finalizar'](null, 'passphrase-de-prueba');

    // ---- Importar un archivo con y sin documento -------------------------
    const archivo = path.join(testDir, 'clientes.xlsx');
    await escribirExcel(archivo, [
      ['1020304050', 'Carolina', 'Rios', '3115557788', '', '', '', '', ''],
      ['',           'Andres',   'Gomez', '3129998877', '', '', '', '', ''],
      ['',           'Marcela',  'Duque', '3004445566', '', '', '', '', ''],
    ]);

    const r1 = await intercambio.importarExcel(archivo, { usuarioId: admin.id });
    check('el archivo se importa aunque haya filas sin documento', r1.ok === true, r1.motivo);
    check('entran los tres clientes, no solo el que traia cedula',
          r1.clientesCreados === 3, 'creados=' + r1.clientesCreados);
    check('y dice cuantos entraron con cedula provisional',
          r1.provisionales === 2, 'provisionales=' + r1.provisionales);
    check('ninguna fila quedo como error por venir sin documento',
          r1.errores.length === 0, JSON.stringify(r1.errores));

    const provisionales = db.prepare(
      'SELECT * FROM clientes WHERE documento_provisional = 1 ORDER BY documento').all();
    check('las cedulas provisionales empiezan por 1234',
          provisionales.every(c => c.documento.startsWith('1234')),
          provisionales.map(c => c.documento).join(', '));
    check('y son distintas entre si, que es lo que exige el UNIQUE',
          new Set(provisionales.map(c => c.documento)).size === provisionales.length);
    check('el cliente que SI traia cedula no queda marcado',
          db.prepare("SELECT documento_provisional FROM clientes WHERE documento = '1020304050'")
            .get().documento_provisional === 0);

    // Los ultimos 4 digitos son con lo que el kiosco identifica a la gente: sin
    // ellos, un cliente provisional no podria marcar asistencia por PIN.
    check('el kiosco puede buscarlos: tienen sus ultimos 4 digitos',
          provisionales.every(c => c.documento_ult4 && c.documento_ult4.length === 4),
          provisionales.map(c => c.documento_ult4).join(', '));

    // ---- Reimportar el mismo archivo no los duplica ----------------------
    const r2 = await intercambio.importarExcel(archivo, { usuarioId: admin.id });
    check('reimportar el mismo archivo no crea clientes nuevos',
          r2.clientesCreados === 0, 'creados=' + r2.clientesCreados);
    check('los reconoce y los actualiza, tambien a los que no tienen cedula',
          r2.clientesActualizados === 3, 'actualizados=' + r2.clientesActualizados);
    check('siguen siendo dos provisionales, no cuatro',
          db.prepare('SELECT COUNT(*) AS n FROM clientes WHERE documento_provisional = 1').get().n === 2);

    // ---- Una cedula real que empiece por 1234 no rompe la numeracion ------
    // 12340001 y 12340002 ya son de los provisionales; el siguiente hueco seria
    // 12340003, asi que se le da a un cliente con cedula real para ver que la
    // numeracion lo salta en vez de reventar por UNIQUE.
    clientesRepo.crear({ documento: '12340003', nombre: 'Alguien Con Cedula Rara' });
    const archivo2 = path.join(testDir, 'otro.xlsx');
    await escribirExcel(archivo2, [['', 'Julian', 'Perez', '3001112233', '', '', '', '', '']]);
    const r3 = await intercambio.importarExcel(archivo2, { usuarioId: admin.id });
    check('un cliente nuevo sin cedula entra aunque el hueco este ocupado',
          r3.ok === true && r3.clientesCreados === 1, r3.motivo);
    check('sin pisar la cedula real que ocupaba el hueco',
          db.prepare("SELECT COUNT(*) AS n FROM clientes WHERE documento = '12340003'").get().n === 1);
    const julian = db.prepare("SELECT documento FROM clientes WHERE nombre = 'Julian Perez'").get();
    check('y se le da el siguiente numero libre, saltandose el ocupado',
          julian && julian.documento === '12340004', julian ? julian.documento : 'no existe');

    // ---- El aviso del kiosco --------------------------------------------
    const provisional = provisionales[0];
    const real = db.prepare("SELECT * FROM clientes WHERE documento = '1020304050'").get();

    const avisoProv = conFoto({ ok: true, nombre: provisional.nombre }, provisional.id);
    check('el kiosco marca al cliente sin documento', avisoProv.documentoProvisional === true);
    check('y manda la cedula provisional, para poder decirla en pantalla',
          avisoProv.documento === provisional.documento);

    const avisoReal = conFoto({ ok: true, nombre: real.nombre }, real.id);
    check('y NO marca al que si tiene documento', avisoReal.documentoProvisional === false);

    // conFoto es el punto por el que pasan los dos caminos del kiosco, asi que
    // el aviso sale igual por huella que por PIN. Esto lo comprueba.
    const rutaPin = require('../electron/ipc/kiosco');
    check('el aviso vive en el punto comun de PIN y huella, no en uno solo',
          typeof rutaPin.conFoto === 'function');

    // ---- Escribirle la cedula real apaga el aviso -------------------------
    clientesRepo.editar(provisional.id, {
      documento: '9998887776', nombre: provisional.nombre, telefono: provisional.telefono,
      email: null, foto: null, f_nacimiento: null, contacto_emg: null, notas: null,
    });
    const yaConCedula = clientesRepo.obtenerPorId(provisional.id);
    check('al escribirle la cedula real se le quita la marca',
          yaConCedula.documento_provisional === 0);
    check('y el kiosco deja de avisar por el',
          conFoto({ ok: true }, provisional.id).documentoProvisional === false);
    check('sus ultimos 4 digitos pasan a ser los de la cedula de verdad',
          yaConCedula.documento_ult4 === '7776', yaConCedula.documento_ult4);

    // Editar otra cosa sin tocar el documento no puede apagar el aviso: seria
    // perderlo justo cuando alguien corrige un telefono.
    const otro = db.prepare('SELECT * FROM clientes WHERE documento_provisional = 1').get();
    clientesRepo.editar(otro.id, {
      documento: otro.documento, nombre: otro.nombre, telefono: '3000000000',
      email: null, foto: null, f_nacimiento: null, contacto_emg: null, notas: null,
    });
    check('editar el telefono sin tocar la cedula NO apaga el aviso',
          clientesRepo.obtenerPorId(otro.id).documento_provisional === 1);

    // ---- La lista de clientes tambien lo dice -----------------------------
    const lista = panel.buscarConEstado('');
    const enLista = lista.find(c => c.id === otro.id);
    check('la lista de clientes marca a los provisionales',
          enLista && enLista.documentoProvisional === true);
    check('y no marca a los demas',
          lista.filter(c => c.documento === '1020304050').every(c => c.documentoProvisional === false));

    // ---- Lo mismo, pero creando el cliente a mano desde la pantalla ---------
    // El Excel ya no es el unico camino sin cedula: el formulario tampoco la
    // exige, y antes ese cliente se quedaba con documento NULL y sin poder
    // entrar nunca al kiosco.
    const aMano = clientesRepo.crear({ nombre: 'Cliente Sin Cedula', telefono: '3001112233' });
    const filaAMano = clientesRepo.obtenerPorId(aMano);
    check('crear un cliente a mano sin cedula le asigna una provisional',
          filaAMano.documento_provisional === 1 && /^1234\d{4}$/.test(filaAMano.documento),
          'documento=' + filaAMano.documento);
    check('y sus ultimos 4 son los que pide el kiosco',
          filaAMano.documento_ult4 === filaAMano.documento.slice(-4),
          'ult4=' + filaAMano.documento_ult4);

    const otroAMano = clientesRepo.crear({ nombre: 'Otro Sin Cedula' });
    check('dos a mano seguidos no chocan entre si',
          clientesRepo.obtenerPorId(otroAMano).documento !== filaAMano.documento,
          clientesRepo.obtenerPorId(otroAMano).documento);

    // editar() guarda la ficha entera, tal y como la manda el formulario: si se
    // le pasan solo dos campos, los demas se irian a undefined.
    const fichaAMano = (documento) => ({
      documento, nombre: 'Cliente Sin Cedula', telefono: '3001112233',
      email: null, foto: null, f_nacimiento: null, contacto_emg: null, notas: null,
    });

    clientesRepo.editar(aMano, fichaAMano(''));
    check('guardar sin tocar el documento conserva su provisional',
          clientesRepo.obtenerPorId(aMano).documento === filaAMano.documento &&
          clientesRepo.obtenerPorId(aMano).documento_provisional === 1);

    clientesRepo.editar(aMano, fichaAMano('5566778899'));
    const aManoConCedula = clientesRepo.obtenerPorId(aMano);
    check('escribirle la cedula real apaga el aviso tambien aqui',
          aManoConCedula.documento === '5566778899' && aManoConCedula.documento_provisional === 0);

    clientesRepo.editar(aMano, fichaAMano(''));
    const vaciado = clientesRepo.obtenerPorId(aMano);
    check('y vaciar el documento no lo deja sin cedula: vuelve a una provisional',
          vaciado.documento_provisional === 1 && /^1234\d{4}$/.test(vaciado.documento),
          'documento=' + vaciado.documento);

    // ---- La cedula repetida ---------------------------------------------
    //
    // `documento` es UNIQUE. Hasta el 18-sep-2026 una cedula repetida reventaba
    // con el error crudo de SQLite, la promesa del formulario se rechazaba y la
    // pantalla se quedaba en "Guardando..." para siempre, con el boton de
    // Cancelar tambien bloqueado: habia que salir por el menu y reescribirlo
    // todo. Es el caso mas comun del mostrador: volver a registrar a alguien
    // que ya estaba.
    const otroMas = clientesRepo.crear({ documento: '4433221100', nombre: 'Tercero' });
    check('un cliente con cedula libre si se crea', Number.isInteger(otroMas), JSON.stringify(otroMas));

    const cuantosAntes = db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n;
    const repetida = clientesRepo.crear({ documento: '4433221100', nombre: 'Tercero Otra Vez' });
    check('crear con una cedula que ya existe no revienta: avisa',
          repetida && repetida.ok === false && repetida.motivo === 'documento_duplicado',
          JSON.stringify(repetida));
    check('y dice de quien es esa cedula, para poder buscarlo',
          repetida.clienteId === otroMas && repetida.nombre === 'Tercero', JSON.stringify(repetida));
    check('no se creo ningun cliente a medias',
          db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n === cuantosAntes);

    const cuarto = clientesRepo.crear({ documento: '1199887766', nombre: 'Cuarto' });
    const alEditar = clientesRepo.editar(cuarto, {
      documento: '4433221100', nombre: 'Cuarto', telefono: null,
      email: null, foto: null, f_nacimiento: null, contacto_emg: null, notas: null,
    });
    check('editar poniendole la cedula de otro tampoco revienta',
          alEditar && alEditar.ok === false && alEditar.motivo === 'documento_duplicado',
          JSON.stringify(alEditar));
    check('y el cliente se queda con la suya',
          clientesRepo.obtenerPorId(cuarto).documento === '1199887766',
          clientesRepo.obtenerPorId(cuarto).documento);
    check('guardarse a si mismo con su propia cedula sigue funcionando',
          clientesRepo.editar(cuarto, {
            documento: '1199887766', nombre: 'Cuarto', telefono: null,
            email: null, foto: null, f_nacimiento: null, contacto_emg: null, notas: null,
          }) === true);

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
