const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { getDb } = require('../db/connection');
const { obtenerDekEnMemoria } = require('../crypto/dek');

// Herramientas del panel de desarrollador: diagnosticar la instalacion y vaciar
// datos. Todo lo que hay aqui es destructivo o de solo lectura; nada de esto lo
// usa el mostrador.

const FLAG_RESET = 'reset-pendiente.flag';

// Las zonas son los tres bloques en que se puede partir la base sin dejarla
// incoherente. No hay zona de "planes" ni de "usuarios": los planes son el
// catalogo y los usuarios no se borran nunca (medio historial apunta a ellos),
// asi que un vaciado los conserva siempre. Los planes se borran de UNO en uno,
// y solo los que ninguna membresia usa: ver eliminarPlan().
//
// El orden de los DELETE dentro de cada zona es el orden de las claves foraneas,
// de hijo a padre. Con foreign_keys = ON, hacerlo al reves no borra a medias:
// falla y deja todo como estaba, que es lo correcto pero no lo que se pidio.
const ZONAS = {
  clientes: {
    etiqueta: 'Clientes',
    detalle: 'clientes, membresías, pagos, pausas, asistencias, huellas y fotos',
    contar: () => contarDe('clientes'),
  },
  inventario: {
    etiqueta: 'Inventario',
    detalle: 'productos y sus imágenes',
    contar: () => contarDe('productos'),
  },
  ventas: {
    etiqueta: 'Ventas y caja',
    detalle: 'ventas, sus líneas, sesiones de caja y movimientos',
    contar: () => contarDe('ventas'),
  },
};

function contarDe(tabla) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM ' + tabla).get().n;
}

function rutaUserData() {
  return app.getPath('userData');
}

function rutaDb() {
  return path.join(rutaUserData(), 'gym.db');
}

function tamanoDe(ruta) {
  try { return fs.statSync(ruta).size; } catch (e) { return 0; }
}

// Las copias que dejan atras un restaurar y un reset de fabrica. Se llaman
// gym.db.<algo> con punto; el -wal y el -shm de la base viva llevan guion y por
// eso no entran aqui.
function copiasAntiguas() {
  const dir = rutaUserData();
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('gym.db.'))
    .map(f => ({ nombre: f, ruta: path.join(dir, f), bytes: tamanoDe(path.join(dir, f)) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function conteos() {
  const db = getDb();
  const tablas = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(r => r.name);

  return tablas.map(t => ({
    tabla: t,
    filas: db.prepare('SELECT COUNT(*) AS n FROM "' + t + '"').get().n,
  }));
}

function diagnostico() {
  const db = getDb();
  const backupService = require('./backup');
  const sidecar = require('./sidecarProceso');

  const carpetaRespaldos = backupService.carpetaRespaldosDefault();
  const respaldos = backupService.listarRespaldos();
  const exeSidecar = sidecar.rutaExe();

  // quick_check y no integrity_check: recorre lo que hace falta para detectar
  // corrupcion, pero sin verificar cada indice de cada tabla, y en la base de un
  // gimnasio la diferencia es entre responder al instante o colgar la pantalla.
  let integridad;
  try {
    integridad = String(db.pragma('quick_check', { simple: true }));
  } catch (e) {
    integridad = 'no se pudo comprobar: ' + e.message;
  }

  const copias = copiasAntiguas();

  return {
    rutas: {
      userData: rutaUserData(),
      db: rutaDb(),
      respaldos: carpetaRespaldos,
      sidecar: exeSidecar,
    },
    tamanos: {
      db: tamanoDe(rutaDb()),
      wal: tamanoDe(rutaDb() + '-wal'),
      respaldos: respaldos.reduce((suma, r) => suma + r.tamanoBytes, 0),
      copiasAntiguas: copias.reduce((suma, c) => suma + c.bytes, 0),
    },
    versiones: {
      app: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      sqlite: db.prepare('SELECT sqlite_version() AS v').get().v,
    },
    migraciones: db.prepare('SELECT nombre, aplicada_en FROM _migraciones ORDER BY nombre').all(),
    integridad,
    // El estado del cifrado es la primera pregunta cuando algo "no guarda": sin
    // DEK en memoria no se leen fotos ni huellas ni se puede respaldar.
    cifradoAbierto: obtenerDekEnMemoria() !== null,
    sidecar: {
      instalado: !!exeSidecar,
      vivo: sidecar.estaVivo(),
    },
    respaldos: { cuantos: respaldos.length, ultimo: respaldos.length ? respaldos[0].fecha : null },
    copiasAntiguas: copias,
    conteos: conteos(),
  };
}

// Cuantas filas se lleva cada zona, para poder decirlo antes de borrar y no
// despues.
function resumenZonas() {
  return Object.entries(ZONAS).map(([id, z]) => ({
    id, etiqueta: z.etiqueta, detalle: z.detalle, filas: z.contar(),
  }));
}

// El inventario no se puede vaciar solo si hay ventas que lo referencian:
// venta_items.producto_id apunta a productos, y borrar el producto dejaria la
// linea de una venta apuntando al vacio. En vez de llevarse las ventas por su
// cuenta -- que seria una sorpresa desagradable -- se dice y se deja elegir.
function ventasQueBloquean(zonas) {
  if (!zonas.includes('inventario') || zonas.includes('ventas')) return 0;
  return getDb().prepare('SELECT COUNT(*) AS n FROM venta_items').get().n;
}

function vaciar(zonas) {
  const db = getDb();
  const pedidas = (zonas || []).filter(z => ZONAS[z]);
  if (pedidas.length === 0) return { ok: false, motivo: 'sin_zonas' };

  const bloqueantes = ventasQueBloquean(pedidas);
  if (bloqueantes > 0) {
    return { ok: false, motivo: 'inventario_con_ventas', lineasDeVenta: bloqueantes };
  }

  const quiere = (z) => pedidas.includes(z);
  const borrados = {};
  const borrar = (sql) => db.prepare(sql).run().changes;

  const enUnaSolaTransaccion = db.transaction(() => {
    if (quiere('clientes')) {
      borrados.asistencias = borrar('DELETE FROM asistencias');
      borrados.pausas = borrar('DELETE FROM membresia_pausas');
      borrados.pagos = borrar('DELETE FROM pagos');
      // Antes que las membresias: apunta a las dos, y sin ON DELETE CASCADE.
      // Se anadio en la migracion 006, despues de escribirse esta rutina, y
      // faltaba aqui: con un solo recordatorio enviado, borrar clientes moria
      // por clave foranea y el panel se quedaba en "Borrando..." para siempre.
      borrados.recordatorios = borrar('DELETE FROM recordatorios_enviados');
      borrados.membresias = borrar('DELETE FROM membresias');
      borrados.huellas = borrar('DELETE FROM huellas');
    }

    if (quiere('ventas')) {
      borrados.venta_items = borrar('DELETE FROM venta_items');
      borrados.ventas = borrar('DELETE FROM ventas');
      borrados.caja_movimientos = borrar('DELETE FROM caja_movimientos');
      borrados.caja_sesiones = borrar('DELETE FROM caja_sesiones');
    }

    if (quiere('inventario')) {
      borrados.imagenes_producto = borrar("DELETE FROM imagenes WHERE entidad = 'producto'");
      borrados.productos = borrar('DELETE FROM productos');
    }

    if (quiere('clientes')) {
      borrados.imagenes_cliente = borrar("DELETE FROM imagenes WHERE entidad = 'cliente'");
      // Una venta puede llevar cliente y sobrevivir sin el: se le quita la
      // referencia en vez de arrastrar la venta, que es dinero que si entro.
      borrados.ventas_sin_cliente = borrar('UPDATE ventas SET cliente_id = NULL WHERE cliente_id IS NOT NULL');
      borrados.clientes = borrar('DELETE FROM clientes');
    }
  });

  enUnaSolaTransaccion();

  // Fuera de la transaccion: SQLite no admite VACUUM dentro de una. Sin esto el
  // archivo conserva el tamano que tenia aunque quede vacio por dentro.
  try { db.exec('VACUUM'); } catch (e) { /* que no compacte no invalida el borrado */ }

  return { ok: true, zonas: pedidas, borrados };
}

// ------------------------------------------------------------------ planes
//
// Borrar un plan del catalogo. Hasta el 12-sep-2026 solo se podian desactivar, y
// en la base real se acumulaban seis desactivados ("Dia", "Dia " con un espacio,
// "Anual ", "Trimestral"...) que nadie habia vendido nunca.
//
// Solo se borra un plan que NINGUNA membresia usa, tampoco una anulada.
// membresias.plan_id es obligatorio y apunta a planes: un plan con membresias no
// se puede borrar sin llevarse por delante esas membresias, con sus pagos y
// asistencias -- historial de clientes de verdad. Igual que el inventario con
// ventas, el panel se frena y dice cuantas lo bloquean. Para esos esta
// "Desactivar" en la pantalla de Planes.

function planesConUso() {
  return getDb().prepare(`
    SELECT p.id, p.nombre, p.tipo, p.precio, p.activo,
           (SELECT COUNT(*) FROM membresias m WHERE m.plan_id = p.id) AS membresias,
           (SELECT COUNT(*) FROM membresias m WHERE m.plan_id = p.id AND m.anulada = 1) AS anuladas
    FROM planes p
    ORDER BY p.activo DESC, p.nombre
  `).all().map(p => ({
    ...p,
    // "Dia" y "Dia " se ven iguales en una tabla. Antes de borrar uno hay que
    // poder saber cual es.
    nombreConEspacios: p.nombre !== p.nombre.trim(),
  }));
}

function eliminarPlan(planId) {
  const db = getDb();
  const borrar = db.transaction(() => {
    const plan = db.prepare('SELECT id, nombre, tipo, precio, activo FROM planes WHERE id = ?').get(planId);
    if (!plan) return { ok: false, motivo: 'plan_no_existe' };

    // Se cuenta DENTRO de la transaccion: si entre que se pinto la lista y se
    // pulso borrar alguien vendio ese plan, aqui se ve.
    const n = db.prepare('SELECT COUNT(*) AS n FROM membresias WHERE plan_id = ?').get(planId).n;
    if (n > 0) return { ok: false, motivo: 'plan_con_membresias', membresias: n, nombre: plan.nombre };

    db.prepare('DELETE FROM planes WHERE id = ?').run(planId);
    return { ok: true, plan };
  });
  return borrar();
}

// Lectura de la tabla auditoria. Se escribe desde hace tiempo -- accesos de
// desarrollador, anulaciones de venta, ajustes de stock -- pero hasta ahora no
// habia forma de leerla sin abrir el gym.db con una herramienta de SQLite.
//
// Los filtros se arman con parametros y nunca pegando el texto en el SQL: lo que
// llega viene de un campo de la pantalla, y aunque solo lo escriba el
// desarrollador, un apostrofe en la busqueda no puede convertirse en una
// consulta distinta.
const TOPE_AUDITORIA = 500;

function auditoria({ limite, usuarioId, accion, texto } = {}) {
  const condiciones = [];
  const parametros = [];

  if (usuarioId) { condiciones.push('a.usuario_id = ?'); parametros.push(usuarioId); }
  if (accion) { condiciones.push('a.accion = ?'); parametros.push(accion); }
  if (texto) {
    condiciones.push('(a.entidad LIKE ? OR a.detalle LIKE ? OR u.nombre LIKE ?)');
    const like = '%' + texto + '%';
    parametros.push(like, like, like);
  }

  const donde = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  const tope = Math.min(Number(limite) || 100, TOPE_AUDITORIA);

  return getDb().prepare(
    'SELECT a.id, a.fecha, a.accion, a.entidad, a.entidad_id, a.detalle, ' +
    '       a.usuario_id, u.nombre AS usuario_nombre, u.usuario AS usuario_login ' +
    'FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id ' +
    donde + ' ORDER BY a.fecha DESC, a.id DESC LIMIT ?'
  ).all(...parametros, tope);
}

// Para llenar el desplegable del filtro con lo que de verdad hay escrito, y no
// con una lista fija que se queda vieja en cuanto alguien anote una accion nueva.
function accionesAuditadas() {
  return getDb().prepare('SELECT DISTINCT accion FROM auditoria ORDER BY accion').all().map(r => r.accion);
}

// El reset de fabrica no puede borrar gym.db aqui mismo: better-sqlite3 la tiene
// abierta y Windows no deja borrar un archivo en uso. Se deja una bandera y se
// reinicia; connection.js la aplica antes de abrir nada, que es el mismo camino
// que ya usa el restaurar de un respaldo.
function marcarResetDeFabrica() {
  fs.writeFileSync(path.join(rutaUserData(), FLAG_RESET), new Date().toISOString(), 'utf-8');
  return { ok: true, requiereReiniciar: true };
}

function borrarCopiasAntiguas() {
  let borradas = 0;
  let bytes = 0;
  for (const copia of copiasAntiguas()) {
    try {
      fs.rmSync(copia.ruta, { force: true });
      borradas++;
      bytes += copia.bytes;
    } catch (e) { /* si una esta bloqueada, se sigue con las demas */ }
  }
  return { ok: true, borradas, bytes };
}

module.exports = {
  ZONAS, FLAG_RESET, TOPE_AUDITORIA,
  diagnostico, conteos, resumenZonas, vaciar, auditoria, accionesAuditadas,
  planesConUso, eliminarPlan,
  marcarResetDeFabrica, borrarCopiasAntiguas, copiasAntiguas,
};
