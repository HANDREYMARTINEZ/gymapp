const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-caja-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-caja-' + Date.now());
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
    const repo = require('../electron/db/repos/caja');

    conn.getDb().prepare(`
      INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
      VALUES ('Cajero', 'cajero', 'x', 'asistente', 1, ?)
    `).run(new Date().toISOString());
    const usuarioId = 1;

    // --- sin sesion abierta ---
    check('al principio no hay sesion abierta', repo.sesionAbierta() === undefined);
    const sinSesion = repo.registrarMovimiento({ tipo: 'ingreso', concepto: 'venta', monto: 5000, usuarioId });
    check('no se puede mover dinero sin caja abierta',
          !sinSesion.ok && sinSesion.motivo === 'sin_sesion_abierta', 'motivo=' + sinSesion.motivo);
    const cierreSinSesion = repo.cerrar({ efectivoContado: 1000 });
    check('no se puede cerrar sin caja abierta',
          !cierreSinSesion.ok && cierreSinSesion.motivo === 'sin_sesion_abierta');

    // --- apertura ---
    const mala = repo.abrir({ usuarioId, baseInicial: -100 });
    check('rechaza una base negativa', !mala.ok && mala.motivo === 'base_invalida');

    const ap = repo.abrir({ usuarioId, baseInicial: 50000 });
    check('abrir caja devuelve ok', ap.ok && ap.id > 0, 'id=' + ap.id);
    check('sesionAbierta ya la encuentra', repo.sesionAbierta() && repo.sesionAbierta().id === ap.id);
    check('sesionAbierta trae el nombre del usuario', repo.sesionAbierta().usuario_nombre === 'Cajero');

    const dobleApertura = repo.abrir({ usuarioId, baseInicial: 10000 });
    check('no deja abrir una segunda caja',
          !dobleApertura.ok && dobleApertura.motivo === 'ya_hay_sesion_abierta', 'motivo=' + dobleApertura.motivo);

    // --- validaciones de movimiento ---
    const tipoMalo = repo.registrarMovimiento({ tipo: 'regalo', concepto: 'x', monto: 100, usuarioId });
    check('rechaza un tipo que no es ingreso ni egreso', !tipoMalo.ok && tipoMalo.motivo === 'tipo_invalido');

    const montoCero = repo.registrarMovimiento({ tipo: 'ingreso', concepto: 'x', monto: 0, usuarioId });
    check('rechaza monto cero', !montoCero.ok && montoCero.motivo === 'monto_invalido');

    const montoNeg = repo.registrarMovimiento({ tipo: 'egreso', concepto: 'x', monto: -500, usuarioId });
    check('rechaza monto negativo (el sentido lo da el tipo, no el signo)',
          !montoNeg.ok && montoNeg.motivo === 'monto_invalido');

    const sinConcepto = repo.registrarMovimiento({ tipo: 'egreso', concepto: '   ', monto: 500, usuarioId });
    check('rechaza un concepto en blanco', !sinConcepto.ok && sinConcepto.motivo === 'concepto_requerido');

    // --- movimientos reales ---
    check('ingreso registrado', repo.registrarMovimiento({ tipo: 'ingreso', concepto: 'Venta agua', monto: 3000, usuarioId }).ok);
    check('otro ingreso', repo.registrarMovimiento({ tipo: 'ingreso', concepto: 'Venta barra', monto: 2500, usuarioId }).ok);
    check('egreso registrado', repo.registrarMovimiento({ tipo: 'egreso', concepto: 'Domicilio agua', monto: 1500, usuarioId }).ok);

    const r = repo.resumen(ap.id);
    // El dashboard pinta "Abierta por <nombre>" desde el resumen, no desde
    // sesionAbierta(). Cuando resumen() hacia un SELECT * sin JOIN salia vacio.
    check('el resumen trae la sesion con el nombre del usuario',
          r.sesion.usuario_nombre === 'Cajero', 'leyo: ' + r.sesion.usuario_nombre);
    check('suma los ingresos', r.ingresos === 5500, 'ingresos=' + r.ingresos);
    check('suma los egresos', r.egresos === 1500, 'egresos=' + r.egresos);
    check('esperado = base + ingresos - egresos', r.esperado === 54000, 'esperado=' + r.esperado);
    check('lista los tres movimientos', r.movimientos.length === 3, r.movimientos.length + ' movimientos');
    check('el concepto se guardo sin espacios sobrantes',
          r.movimientos.every(m => m.concepto === m.concepto.trim()));

    // --- cierre con faltante ---
    const conteoMalo = repo.cerrar({ efectivoContado: -5 });
    check('rechaza un conteo negativo', !conteoMalo.ok && conteoMalo.motivo === 'conteo_invalido');

    const cierre = repo.cerrar({ efectivoContado: 53000, nota: 'Faltaron 1000' });
    check('cerrar devuelve ok', cierre.ok);
    check('la diferencia negativa marca faltante', cierre.diferencia === -1000, 'diferencia=' + cierre.diferencia);
    check('ya no hay sesion abierta tras cerrar', repo.sesionAbierta() === undefined);

    const cerrada = repo.resumen(ap.id).sesion;
    check('quedo guardado el efectivo contado', cerrada.efectivo_contado === 53000);
    check('quedo guardada la diferencia', cerrada.diferencia === -1000);
    check('quedo guardada la nota', cerrada.nota === 'Faltaron 1000');
    check('quedo la marca de cierre', !!cerrada.cerrada_en);

    // En el cajon hay billetes: un monto con centavos dejaba el arqueo pidiendo
    // contar $66.000,75, que no existe.
    const conCentavos = repo.abrir({ usuarioId, baseInicial: 1000 });
    check('se abre una sesion para probar los decimales', conCentavos.ok);
    check('un movimiento con decimales se rechaza',
          repo.registrarMovimiento({ tipo: 'ingreso', concepto: 'x', monto: 1000.75, usuarioId }).motivo === 'monto_invalido');
    check('y el arqueo sigue en pesos enteros',
          Number.isInteger(repo.resumen(repo.sesionAbierta().id).esperado));
    repo.cerrar({ efectivoContado: 1000 });

    // --- segunda sesion: el arqueo cuadra exacto ---
    const ap2 = repo.abrir({ usuarioId, baseInicial: 20000 });
    check('se puede abrir otra caja despues de cerrar la anterior', ap2.ok);
    repo.registrarMovimiento({ tipo: 'ingreso', concepto: 'Venta', monto: 10000, usuarioId });
    const cierre2 = repo.cerrar({ efectivoContado: 30000 });
    check('un arqueo exacto da diferencia cero', cierre2.diferencia === 0, 'diferencia=' + cierre2.diferencia);

    // --- sobrante ---
    const ap3 = repo.abrir({ usuarioId, baseInicial: 0 });
    check('se puede abrir con base cero', ap3.ok);
    const cierre3 = repo.cerrar({ efectivoContado: 700 });
    check('la diferencia positiva marca sobrante', cierre3.diferencia === 700, 'diferencia=' + cierre3.diferencia);

    // --- historial ---
    const sesiones = repo.listarSesiones();
    check('el historial trae las cuatro sesiones', sesiones.length === 4, sesiones.length + ' sesiones');
    check('el historial viene de la mas reciente a la mas vieja',
          sesiones[0].id === ap3.id && sesiones[3].id === ap.id);
    check('los movimientos quedaron con su sesion, no revueltos',
          repo.resumen(ap.id).movimientos.length === 3 && repo.resumen(ap2.id).movimientos.length === 1);

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
