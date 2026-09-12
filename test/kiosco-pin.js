const { app, ipcMain, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-kiosco-pin-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-kiosco-pin-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const handlers = {};
const registrarOriginal = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (canal, fn) => { handlers[canal] = fn; registrarOriginal(canal, fn); };

function jpeg(w, h) {
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = (i * 7) % 256; px[i * 4 + 1] = (i * 13) % 256;
    px[i * 4 + 2] = (i * 29) % 256; px[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBitmap(px, { width: w, height: h }).toJPEG(90);
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
    const dekMod = require('../electron/crypto/dek');
    const clientes = require('../electron/db/repos/clientes');
    const membresias = require('../electron/db/repos/membresias');
    const planes = require('../electron/db/repos/planes');
    const caja = require('../electron/db/repos/caja');
    const imagenes = require('../electron/services/imagenes');
    require('../electron/ipc/kiosco');
    require('../electron/ipc/clientes');

    dekMod.guardarDekEnMemoria(dekMod.generarDEK());
    db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
                VALUES ('Cajero', 'cajero', 'x', 'admin', 1, ?)`).run(new Date().toISOString());
    const usuarioId = 1;
    caja.abrir({ usuarioId, baseInicial: 100000 });

    const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 70000, dias_duracion: 30 });
    const conFoto = clientes.crear({ documento: '9900003910', nombre: 'Camila Castro', telefono: '300' });
    const sinFoto = clientes.crear({ documento: '2000004321', nombre: 'Beto Rojas', telefono: '301' });

    for (const id of [conFoto, sinFoto]) {
      const m = membresias.vender({ clienteId: id, planId: mensual, usuarioId });
      membresias.registrarPago({ membresiaId: m, monto: 70000, metodo: 'Efectivo', usuarioId });
    }
    imagenes.guardar({ entidad: 'cliente', entidadId: conFoto, base64: jpeg(200, 200).toString('base64') });

    // ------------------------------------------------------------------- PIN
    check('un cliente recién creado no tiene PIN', clientes.tienePin(conFoto) === false);

    for (const malo of ['123', '12345', 'abcd', '', null, '12 4']) {
      const r = await clientes.asignarPin(conFoto, malo);
      check('rechaza el PIN inválido ' + JSON.stringify(malo),
            r.ok === false && r.motivo === 'pin_invalido');
    }
    check('y ninguno de esos se guardó', clientes.tienePin(conFoto) === false);

    check('acepta un PIN de 4 dígitos', (await clientes.asignarPin(conFoto, '3910')).ok === true);
    check('y ahora dice que sí lo tiene', clientes.tienePin(conFoto) === true);
    check('el PIN no queda en claro en la base',
          db.prepare(`SELECT pin FROM clientes WHERE id = ?`).get(conFoto).pin.indexOf('3910') === -1);

    // El PIN es la mitad de la llave del kiosco: la otra son los últimos 4 del
    // documento. Aquí se comprueba que la pareja de verdad abre.
    const entrada = await handlers['kiosco:marcarPorPin'](null, { ult4: '3910', pin: '3910' });
    check('con el documento y el PIN correctos entra', entrada.ok === true,
          'motivo=' + entrada.motivo);

    check('cambiar el PIN sustituye al anterior', (await clientes.asignarPin(conFoto, '7777')).ok === true);
    const conViejo = await handlers['kiosco:marcarPorPin'](null, { ult4: '3910', pin: '3910' });
    check('el PIN viejo ya no sirve', conViejo.ok === false && conViejo.motivo === 'pin_incorrecto',
          'motivo=' + conViejo.motivo);

    check('quitar el PIN funciona', clientes.quitarPin(conFoto).ok === true);
    check('y despues el cliente ya no tiene', clientes.tienePin(conFoto) === false);
    const sinNinguno = await handlers['kiosco:marcarPorPin'](null, { ult4: '3910', pin: '7777' });
    check('sin PIN no se puede entrar por el kiosco',
          sinNinguno.ok === false && sinNinguno.motivo === 'pin_incorrecto');

    check('quitar el PIN de alguien que no existe no revienta',
          clientes.quitarPin(99999).ok === false);

    // ------------------------------------------------------- 5.7: la foto
    await clientes.asignarPin(conFoto, '1234');
    await clientes.asignarPin(sinFoto, '4321');

    // Se borra la asistencia de antes para poder volver a marcar hoy.
    db.prepare(`DELETE FROM asistencias`).run();

    const conRetrato = await handlers['kiosco:marcarPorPin'](null, { ult4: '3910', pin: '1234' });
    check('marcar asistencia devuelve la foto del cliente',
          typeof conRetrato.foto === 'string' && conRetrato.foto.startsWith('data:image/'),
          String(conRetrato.foto).slice(0, 24));
    check('y dice de qué cliente es', conRetrato.clienteId === conFoto);
    check('junto al nombre de siempre', conRetrato.nombre === 'Camila Castro');

    const sinRetrato = await handlers['kiosco:marcarPorPin'](null, { ult4: '4321', pin: '4321' });
    check('un cliente sin foto devuelve null, no un error',
          sinRetrato.ok === true && sinRetrato.foto === null, 'foto=' + sinRetrato.foto);

    // Repetir la marca da "ya_registrado_hoy": tambien tiene que traer la foto,
    // porque esa pantalla la ve el mostrador igual.
    const repetida = await handlers['kiosco:marcarPorPin'](null, { ult4: '3910', pin: '1234' });
    check('al repetir la asistencia sigue saliendo la foto',
          repetida.ok === false && repetida.motivo === 'ya_registrado_hoy' &&
          String(repetida.foto).startsWith('data:image/'),
          'motivo=' + repetida.motivo);

    // Un PIN equivocado no identifica a nadie: no puede filtrar ninguna foto.
    const fallido = await handlers['kiosco:marcarPorPin'](null, { ult4: '3910', pin: '0000' });
    check('con el PIN equivocado no se devuelve ninguna foto',
          fallido.ok === false && !fallido.foto, 'foto=' + fallido.foto);

    // ---------------------------------------------------------------------
    // El PIN en lote. Los 109 clientes que entraron por el Excel llegaron sin
    // PIN, y sin PIN no pueden marcar asistencia.
    // ---------------------------------------------------------------------
    const identificacion = require('../electron/services/identificacion');

    const antes = clientes.pinesResumen();
    check('el resumen ve a los clientes que ya tienen PIN',
          antes.activos === 2 && antes.conPin === 2 && antes.sinPin === 0,
          JSON.stringify(antes));

    // Tres recien llegados sin PIN, como los del Excel.
    const nuevoA = clientes.crear({ documento: '1111111111', nombre: 'Ana Sin Pin', telefono: '311' });
    const nuevoB = clientes.crear({ documento: '2222220099', nombre: 'Beto Choque', telefono: '312' });
    const nuevoC = clientes.crear({ documento: '3333330099', nombre: 'Carla Choque', telefono: '313' });

    const conFalta = clientes.pinesResumen();
    check('y cuenta a los que le faltan',
          conFalta.activos === 5 && conFalta.sinPin === 3, JSON.stringify(conFalta));

    const pinCorto = await clientes.asignarPinEnLote({ pin: '12', usuarioId });
    check('un PIN que no son 4 digitos se rechaza entero',
          pinCorto.ok === false && pinCorto.motivo === 'pin_invalido');
    check('y no le toca el PIN a nadie', clientes.pinesResumen().sinPin === 3);

    const lote = await clientes.asignarPinEnLote({ pin: '0000', usuarioId });
    check('el lote se lo pone a los tres que no tenian',
          lote.ok === true && lote.asignados === 3, 'asignados=' + lote.asignados);
    check('y ya no falta ninguno', clientes.pinesResumen().sinPin === 0);

    const entra = await identificacion.identificarPorDocumentoYPin('1111', '0000');
    check('uno de ellos ya puede identificarse en el kiosco',
          entra.ok === true && entra.clienteId === nuevoA,
          JSON.stringify(entra.motivo || entra.nombre));

    // Lo que no se puede perder: al que ya tenia su PIN no se le pisa.
    const viejoIntacto = await identificacion.identificarPorDocumentoYPin('3910', '1234');
    check('al que ya tenia PIN propio no se le cambia', viejoIntacto.ok === true);
    const viejoConElComun = await identificacion.identificarPorDocumentoYPin('3910', '0000');
    check('y el PIN comun no le sirve a ese', viejoConElComun.ok === false);

    // Dos clientes con los mismos 4 digitos finales y el mismo PIN son
    // indistinguibles para el kiosco: el lote tiene que cantarlo.
    check('el lote avisa de los que comparten los ultimos 4 digitos',
          (lote.choques || []).length === 1 && lote.choques[0].ult4 === '0099' &&
          lote.choques[0].clientes.length === 2,
          JSON.stringify(lote.choques));
    check('y dice quienes son',
          lote.choques[0].clientes.map(c => c.id).sort().join(',') ===
          [nuevoB, nuevoC].sort().join(','));

    // ---- PIN distinto para cada uno ----
    const azarA = clientes.crear({ documento: '8000001111', nombre: 'Uno Azar', telefono: '321' });
    const azarB = clientes.crear({ documento: '8000002222', nombre: 'Dos Azar', telefono: '322' });
    const azar = await clientes.asignarPinEnLote({ aleatorio: true, usuarioId });
    check('el lote aleatorio se los asigna a los dos',
          azar.ok === true && azar.asignados === 2, 'asignados=' + azar.asignados);
    check('y devuelve la lista en claro, una sola vez',
          azar.generados.length === 2 && azar.generados.every(g => /^[0-9]{4}$/.test(g.pin)),
          JSON.stringify(azar.generados.map(g => g.nombre)));

    // Lo que hace util a la lista: que el PIN que dice sea el que abre.
    const suyo = azar.generados.find(g => g.id === azarA);
    const conSuPin = await identificacion.identificarPorDocumentoYPin('1111', suyo.pin);
    check('el PIN impreso es el que de verdad abre el kiosco',
          conSuPin.ok === true && conSuPin.clienteId === azarA);

    // Y que no sea el mismo para todos: el del otro no le sirve.
    const delOtro = azar.generados.find(g => g.id === azarB);
    if (delOtro.pin !== suyo.pin) {
      const ajeno = await identificacion.identificarPorDocumentoYPin('1111', delOtro.pin);
      check('el PIN de otro cliente no le sirve', ajeno.ok === false);
    } else {
      check('el PIN de otro cliente no le sirve', true, 'salieron iguales por azar, 1 en 10.000');
    }
    check('en claro no queda nada escrito en auditoria',
          db.prepare("SELECT detalle FROM auditoria WHERE accion = 'clientes_pin_lote' ORDER BY id DESC").get()
            .detalle.indexOf(suyo.pin) === -1 ||
          JSON.parse(db.prepare("SELECT detalle FROM auditoria WHERE accion = 'clientes_pin_lote' ORDER BY id DESC").get().detalle).aleatorio === true);

    // Un cliente dado de baja no entra en el lote: no deberia poder marcar.
    const deBaja = clientes.crear({ documento: '4444444444', nombre: 'Dado De Baja', telefono: '314' });
    clientes.darDeBaja({ clienteId: deBaja, usuarioId, motivo: 'prueba' });
    const segundoLote = await clientes.asignarPinEnLote({ pin: '0000', usuarioId });
    check('a un cliente dado de baja no se le pone PIN',
          segundoLote.ok === true && segundoLote.asignados === 0 &&
          clientes.tienePin(deBaja) === false,
          'asignados=' + segundoLote.asignados);

    // Queda escrito quien lo hizo, como cualquier otra operacion masiva. El
    // segundo lote no asigno a nadie y por eso no anota: un lote vacio no
    // ensucia la auditoria.
    const anotado = db.prepare(`SELECT COUNT(*) AS n FROM auditoria
                                WHERE accion = 'clientes_pin_lote'`).get();
    check('el lote que si asigno queda anotado en auditoria, el vacio no',
          anotado.n === 2, 'n=' + anotado.n);

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
