// Panel de desarrollador: el diagnostico, el vaciado por zonas, el borrado de
// respaldos, el reseteo de contrasenas, la auditoria, los datos de demo y el
// reset de fabrica.
//
// Lo que mas se prueba aqui no es que borre, sino que NO borre de mas: que la
// puerta este cerrada sin passphrase, que un vaciado conserve usuarios y llaves,
// que el inventario no se lleve por delante las ventas y que no se pueda borrar
// un archivo cualquiera del disco disfrazado de respaldo.

const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-desarrollador-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-desarrollador-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const handlers = {};
const registrarOriginal = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (canal, fn) => { handlers[canal] = fn; registrarOriginal(canal, fn); };

const PASSPHRASE = 'la-passphrase-del-gimnasio';

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
    require('../electron/ipc/desarrollador');
    require('../electron/ipc/backup');

    const usuarios = require('../electron/db/repos/usuarios');
    const planes = require('../electron/db/repos/planes');
    const clientes = require('../electron/db/repos/clientes');
    const productos = require('../electron/db/repos/productos');
    const membresias = require('../electron/db/repos/membresias');
    const ventas = require('../electron/db/repos/ventas');
    const asistencias = require('../electron/db/repos/asistencias');
    const caja = require('../electron/db/repos/caja');
    const imagenes = require('../electron/services/imagenes');
    const mantenimiento = require('../electron/services/mantenimiento');
    const sesionDev = require('../electron/services/sesionDev');

    // ---- Instalacion con datos de las tres zonas -------------------------
    const admin = await usuarios.crear({ nombre: 'Andrey', usuario: 'andrey', password: 'clave1234', rol: 'admin' });
    await handlers['setup:finalizar'](null, PASSPHRASE);
    // El wizard crea al admin antes de existir la DEK, asi que su primer login
    // pide la passphrase una vez. Se hace aqui para partir de una instalacion ya
    // en marcha, que es sobre la que se usa este panel.
    await handlers['auth:vincularPassphrase'](null,
      { usuario: 'andrey', password: 'clave1234', passphrase: PASSPHRASE });

    const plan = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 120000, dias_duracion: 30 });
    const cliente = clientes.crear({ documento: '111', nombre: 'Carolina', telefono: '300' });
    const memb = membresias.vender({ clienteId: cliente, planId: plan, usuarioId: admin.id });
    membresias.registrarPago({ membresiaId: memb, monto: 120000, metodo: 'Efectivo', usuarioId: admin.id });
    asistencias.registrar({ clienteId: cliente, metodo: 'manual', registradoPor: admin.id });

    const agua = productos.crear({ nombre: 'Agua', p_venta: 3000, p_costo: 1800, stock: 10 }).id;
    caja.abrir({ usuarioId: admin.id, baseInicial: 50000 });
    ventas.registrar({ items: [{ productoId: agua, cantidad: 2 }], metodoPago: 'Efectivo', usuarioId: admin.id });
    imagenes.guardar({ entidad: 'cliente', entidadId: cliente, base64: Buffer.from('foto').toString('base64') });

    const contar = (t) => db.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n;

    // ---- La puerta ------------------------------------------------------
    sesionDev.desactivar();
    const sinPermiso = await handlers['dev:vaciar'](null, ['clientes']);
    check('sin sesion de desarrollador el vaciado no corre',
          sinPermiso.ok === false && sinPermiso.motivo === 'sin_sesion_desarrollador');
    check('y no borro nada', contar('clientes') === 1);
    check('el diagnostico tampoco se sirve sin permiso',
          (await handlers['dev:diagnostico'](null)).ok === false);

    const devMalo = await handlers['auth:accesoDesarrollador'](null, 'no-es-la-passphrase');
    check('una passphrase mala no abre la puerta',
          devMalo.ok === false && sesionDev.estaActiva() === false);

    const dev = await handlers['auth:accesoDesarrollador'](null, PASSPHRASE);
    check('la passphrase correcta la abre', dev.ok === true && sesionDev.estaActiva() === true);

    await handlers['auth:login'](null, 'andrey', 'clave1234');
    check('entrar por el login normal vuelve a cerrarla', sesionDev.estaActiva() === false);

    await handlers['auth:accesoDesarrollador'](null, PASSPHRASE);
    await handlers['auth:cerrarSesion'](null);
    check('cerrar sesion tambien la cierra', sesionDev.estaActiva() === false);

    await handlers['auth:accesoDesarrollador'](null, PASSPHRASE);

    // ---- Diagnostico -----------------------------------------------------
    const d = (await handlers['dev:diagnostico'](null)).datos;
    check('el diagnostico dice que la base esta integra', d.integridad === 'ok', d.integridad);
    check('y que el cifrado esta abierto', d.cifradoAbierto === true);
    check('trae la ruta real de la base', d.rutas.db === path.join(testDir, 'gym.db'));
    check('trae las migraciones aplicadas', d.migraciones.length >= 4, 'n=' + d.migraciones.length);
    check('y el conteo de cada tabla', d.conteos.some(c => c.tabla === 'clientes' && c.filas === 1));

    // ---- El inventario no se lleva las ventas por delante ----------------
    const choque = await handlers['dev:vaciar'](null, ['inventario']);
    check('vaciar solo el inventario se frena si hay ventas que lo referencian',
          choque.ok === false && choque.motivo === 'inventario_con_ventas' && choque.lineasDeVenta === 1);
    check('y no borro ningun producto', contar('productos') === 1);

    // ---- Vaciado de clientes --------------------------------------------
    const vaciado = await handlers['dev:vaciar'](null, ['clientes']);
    check('vaciar la zona de clientes funciona', vaciado.ok === true, vaciado.motivo);
    check('se llevo los clientes', contar('clientes') === 0);
    check('y las membresias, pagos y asistencias que colgaban de ellos',
          contar('membresias') === 0 && contar('pagos') === 0 && contar('asistencias') === 0);
    check('y sus fotos', contar('imagenes') === 0);
    check('pero NO los usuarios', contar('usuarios') >= 1);
    check('ni los planes', contar('planes') === 1);
    check('ni la venta, que es dinero que si entro', contar('ventas') === 1);
    check('a la venta solo se le quito el cliente',
          db.prepare('SELECT cliente_id FROM ventas').get().cliente_id === null);
    check('deja un respaldo antes de borrar', vaciado.respaldo.hecho === true, vaciado.respaldo.motivo);
    check('y lo anota en auditoria',
          !!db.prepare("SELECT 1 FROM auditoria WHERE accion = 'vaciado_zonas'").get());

    // Lo que de verdad importa del vaciado: la instalacion sigue en pie.
    const { obtenerDekEnMemoria, guardarDekEnMemoria } = require('../electron/crypto/dek');
    const dekAntes = obtenerDekEnMemoria();
    guardarDekEnMemoria(null);
    const entraDespues = await handlers['auth:login'](null, 'andrey', 'clave1234');
    check('despues de vaciar, el admin sigue entrando con su misma clave',
          entraDespues.ok === true && !entraDespues.necesitaPassphrase);
    check('y abre la misma DEK: lo cifrado que quede se sigue leyendo',
          obtenerDekEnMemoria().equals(dekAntes));
    await handlers['auth:accesoDesarrollador'](null, PASSPHRASE);

    // ---- Ahora si, inventario junto con ventas ---------------------------
    const vaciado2 = await handlers['dev:vaciar'](null, ['inventario', 'ventas']);
    check('inventario y ventas juntos si se vacian', vaciado2.ok === true, vaciado2.motivo);
    check('no quedan productos ni ventas ni lineas',
          contar('productos') === 0 && contar('ventas') === 0 && contar('venta_items') === 0);
    check('ni sesiones de caja', contar('caja_sesiones') === 0);

    // ---- Respaldos -------------------------------------------------------
    const backupService = require('../electron/services/backup');
    const lista = backupService.listarRespaldos();
    check('los vaciados dejaron respaldos', lista.length >= 2, 'n=' + lista.length);

    const fuera = path.join(testDir, 'no-tocar.txt');
    fs.writeFileSync(fuera, 'contenido ajeno', 'utf-8');
    const intruso = await handlers['dev:eliminarRespaldo'](null, fuera);
    check('no se puede borrar un archivo de fuera de la carpeta de respaldos',
          intruso.ok === false && intruso.motivo === 'fuera_de_la_carpeta');
    check('y el archivo sigue ahi', fs.existsSync(fuera));

    const falso = path.join(backupService.carpetaRespaldosDefault(), 'cualquier-cosa.txt');
    fs.writeFileSync(falso, 'x', 'utf-8');
    check('ni un archivo que no sea .gymbak aunque este en la carpeta',
          (await handlers['dev:eliminarRespaldo'](null, falso)).motivo === 'no_es_un_respaldo');

    const borrado = await handlers['dev:eliminarRespaldo'](null, lista[0].ruta);
    check('un respaldo de verdad si se borra', borrado.ok === true, borrado.motivo);
    check('y desaparece del disco', !fs.existsSync(lista[0].ruta));
    check('y del listado', backupService.listarRespaldos().length === lista.length - 1);

    // ---- Resetear la contrasena de un usuario ----------------------------
    const corta = await handlers['dev:resetearPassword'](null, { usuarioId: admin.id, password: 'ab' });
    check('una contrasena demasiado corta se rechaza',
          corta.ok === false && corta.motivo === 'password_muy_corta');

    const reset = await handlers['dev:resetearPassword'](null, { usuarioId: admin.id, password: 'clave-olvidada-nueva' });
    check('resetear la contrasena sin saber la anterior funciona', reset.ok === true, reset.motivo);
    guardarDekEnMemoria(null);
    check('con la vieja ya no entra',
          (await handlers['auth:login'](null, 'andrey', 'clave1234')).ok === false);
    const conNueva = await handlers['auth:login'](null, 'andrey', 'clave-olvidada-nueva');
    check('con la nueva entra sin pedir la passphrase',
          conNueva.ok === true && !conNueva.necesitaPassphrase);
    check('y le abre la misma DEK, que es lo que lo hace util',
          obtenerDekEnMemoria().equals(dekAntes));

    await handlers['auth:accesoDesarrollador'](null, PASSPHRASE);

    // ---- Auditoria -------------------------------------------------------
    const audTodo = await handlers['dev:auditoria'](null, {});
    check('la auditoria se puede leer', audTodo.ok === true && audTodo.filas.length > 0,
          'n=' + audTodo.filas.length);
    check('trae el nombre del usuario, no solo su id',
          audTodo.filas.every(f => f.usuario_id === null || typeof f.usuario_nombre === 'string'));
    check('viene de la mas nueva a la mas vieja',
          audTodo.filas.every((f, i) => i === 0 || audTodo.filas[i - 1].fecha >= f.fecha));
    check('ofrece las acciones que de verdad hay escritas',
          audTodo.acciones.includes('acceso_desarrollador') && audTodo.acciones.includes('vaciado_zonas'));

    const audFiltrada = await handlers['dev:auditoria'](null, { accion: 'vaciado_zonas' });
    check('filtrar por accion deja solo esa',
          audFiltrada.filas.length > 0 && audFiltrada.filas.every(f => f.accion === 'vaciado_zonas'));

    const audTexto = await handlers['dev:auditoria'](null, { texto: 'inventario' });
    check('buscar por texto encuentra en el detalle',
          audTexto.filas.some(f => (f.detalle || '').includes('inventario')));

    check('un apostrofe en la busqueda no rompe la consulta',
          (await handlers['dev:auditoria'](null, { texto: "no' OR 1=1 --" })).filas.length === 0);

    const audTope = await handlers['dev:auditoria'](null, { limite: 2 });
    check('el limite se respeta', audTope.filas.length <= 2);
    check('y no se puede pedir mas del tope',
          (await handlers['dev:auditoria'](null, { limite: 99999 })).ok === true);

    // ---- Datos de demo ----------------------------------------------------
    const usuariosAntes = contar('usuarios');
    const configAntes = contar('config');

    const demo = await handlers['dev:sembrarDemo'](null);
    check('sembrar datos de demo funciona', demo.ok === true, demo.motivo);
    check('crea los 12 clientes de ejemplo', demo.creado.clientes === 12);
    check('con planes, productos, membresias y ventas',
          demo.creado.planes === 3 && demo.creado.productos === 3
          && demo.creado.membresias === 2 && demo.creado.ventas === 2);
    check('y asistencias repartidas por la semana, para el dashboard',
          demo.creado.asistencias > 10, 'n=' + demo.creado.asistencias);

    // Lo que de verdad hay que probar del seed: que no toque la instalacion.
    check('NO crea usuarios', contar('usuarios') === usuariosAntes);
    check('NI toca la configuracion ni las llaves de cifrado', contar('config') === configAntes);

    const demoDocs = db.prepare("SELECT COUNT(*) AS n FROM clientes WHERE documento LIKE '99%'").get().n;
    check('los clientes de demo se reconocen por su documento 99xxxx', demoDocs === 12);

    check('el admin sigue entrando despues de sembrar',
          (await handlers['auth:login'](null, 'andrey', 'clave-olvidada-nueva')).ok === true);
    await handlers['auth:accesoDesarrollador'](null, PASSPHRASE);

    check('sembrar queda anotado en auditoria',
          !!db.prepare("SELECT 1 FROM auditoria WHERE accion = 'datos_demo_sembrados'").get());

    // Sembrar dos veces no puede reventar por el indice unico de asistencias
    // (un cliente, un dia, una marca).
    const demo2 = await handlers['dev:sembrarDemo'](null);
    check('sembrar dos veces seguidas no revienta', demo2.ok === true, demo2.motivo);

    // Y el vaciado deshace lo sembrado, que es lo que promete la pantalla.
    const limpia = await handlers['dev:vaciar'](null, ['clientes', 'inventario', 'ventas']);
    check('vaciar deshace los datos de demo',
          limpia.ok === true && contar('clientes') === 0 && contar('productos') === 0);
    check('y los usuarios siguen intactos', contar('usuarios') === usuariosAntes);

    // ---- Reset de fabrica: la bandera, no el reinicio ---------------------
    // El handler reinicia la app, asi que aqui se prueba el servicio: que deje la
    // bandera puesta y que conectar() la aplique apartando la base en vez de
    // borrarla.
    const marca = mantenimiento.marcarResetDeFabrica();
    check('el reset de fabrica deja la bandera puesta',
          marca.ok === true && fs.existsSync(path.join(testDir, mantenimiento.FLAG_RESET)));

    db.close();
    conn.conectar();
    const db2 = conn.getDb();

    check('al reconectar, la bandera ya no esta',
          !fs.existsSync(path.join(testDir, mantenimiento.FLAG_RESET)));
    check('la base quedo vacia: la app arranca en el asistente',
          db2.prepare("SELECT COUNT(*) AS n FROM config WHERE clave = 'setup_completo'").get().n === 0);
    check('y sin usuarios', db2.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0);

    const apartadas = fs.readdirSync(testDir).filter(f => f.startsWith('gym.db.antes-de-reset-'));
    check('la base anterior no se borro, se aparto', apartadas.length >= 1, apartadas.join(', '));
    check('y el panel la ve como copia antigua',
          mantenimiento.copiasAntiguas().some(c => c.nombre.startsWith('gym.db.antes-de-reset-')));

    const limpieza = mantenimiento.borrarCopiasAntiguas();
    check('las copias antiguas se pueden borrar desde el panel',
          limpieza.ok === true && limpieza.borradas >= 1 && mantenimiento.copiasAntiguas().length === 0);

    db2.close();
  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallos === 0 ? 0 : 1);
});
