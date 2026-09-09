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
