const { ipcMain, app } = require('electron');
const mantenimiento = require('../services/mantenimiento');
const backupService = require('../services/backup');
const sesionDev = require('../services/sesionDev');
const sidecar = require('../services/sidecarHuella');
const huellaDev = require('../services/huellaDesarrollador');
const usuariosRepo = require('../db/repos/usuarios');
const { getDb } = require('../db/connection');

// Panel de desarrollador. Todo lo de aqui borra datos o los saca a la luz, y
// nada de ello lo puede necesitar el mostrador.
//
// La puerta se comprueba en cada handler y no una sola vez al entrar: esconder
// la pantalla no protege nada, porque el canal IPC sigue abierto para cualquiera
// que llegue a window.api. Quien no haya escrito la passphrase en esta sesion no
// pasa de aqui.
function conPermiso(fn) {
  return async (evt, ...args) => {
    if (!sesionDev.estaActiva()) return { ok: false, motivo: 'sin_sesion_desarrollador' };
    return fn(evt, ...args);
  };
}

function anotarAuditoria(accion, detalle) {
  const db = getDb();
  const dev = db.prepare("SELECT id FROM usuarios WHERE usuario = 'desarrollador'").get();
  db.prepare(`
    INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
    VALUES (?, ?, 'sistema', NULL, ?, ?)
  `).run(dev ? dev.id : null, accion, new Date().toISOString(), detalle || null);
}

// Antes de cualquier borrado se intenta dejar un respaldo. Si falla no se
// cancela la operacion -- el desarrollador pidio borrar y sabe lo que pide --
// pero se devuelve el motivo para que la pantalla lo diga en vez de callarlo.
async function respaldoDeSeguridad() {
  try {
    const r = await backupService.generarRespaldo();
    return { hecho: true, ruta: r.ruta };
  } catch (e) {
    return { hecho: false, motivo: e.message };
  }
}

// La huella del desarrollador: registrarla, cambiarla o quitarla. Solo desde
// dentro del panel, es decir, despues de haber entrado con la passphrase o con
// la huella anterior.
ipcMain.handle('dev:huellaEstado', conPermiso(() => ({ ok: true, ...huellaDev.estado() })));

ipcMain.handle('dev:registrarHuella', conPermiso(async () => {
  let templateBase64;
  try {
    templateBase64 = await sidecar.enrolar(huellaDev.ID_LECTOR);
  } catch (e) {
    const conocidos = ['sidecar_ajeno', 'lector_atascado', 'sin_respuesta'];
    return { ok: false, motivo: conocidos.includes(e.message) ? e.message : 'sin_lector' };
  }
  const r = huellaDev.guardar(Buffer.from(templateBase64, 'base64'));
  if (r.ok) anotarAuditoria('huella_desarrollador_registrada', null);
  return r;
}));

ipcMain.handle('dev:borrarHuella', conPermiso(() => {
  const r = huellaDev.borrar();
  if (r.borrada) anotarAuditoria('huella_desarrollador_borrada', null);
  return r;
}));

ipcMain.handle('dev:diagnostico', conPermiso(() => ({ ok: true, datos: mantenimiento.diagnostico() })));

ipcMain.handle('dev:zonas', conPermiso(() => ({ ok: true, zonas: mantenimiento.resumenZonas() })));

ipcMain.handle('dev:vaciar', conPermiso(async (_evt, zonas) => {
  const respaldo = await respaldoDeSeguridad();
  const r = mantenimiento.vaciar(zonas);
  if (r.ok) anotarAuditoria('vaciado_zonas', (r.zonas || []).join(', '));
  return { ...r, respaldo };
}));

// Reset de fabrica: la app se reinicia y vuelve al asistente de instalacion.
// Igual que el restaurar, esta llamada no vuelve si sale bien.
ipcMain.handle('dev:resetFabrica', conPermiso(async () => {
  const respaldo = await respaldoDeSeguridad();
  anotarAuditoria('reset_de_fabrica', respaldo.hecho ? 'respaldo previo: ' + respaldo.ruta : 'sin respaldo previo');

  const r = mantenimiento.marcarResetDeFabrica();
  if (r.ok) {
    app.relaunch();
    app.exit(0);
  }
  return { ...r, respaldo };
}));

ipcMain.handle('dev:borrarCopiasAntiguas', conPermiso(() => mantenimiento.borrarCopiasAntiguas()));

ipcMain.handle('dev:eliminarRespaldo', conPermiso((_evt, ruta) => {
  const r = backupService.eliminarRespaldo(ruta);
  if (r.ok) anotarAuditoria('respaldo_eliminado', r.nombre);
  return r;
}));

// Resetear la contrasena de cualquier usuario sin saber la anterior.
//
// Es la unica salida cuando el admin del gimnasio olvida su clave: hasta ahora
// habia que restaurar un respaldo entero. Se apoya en el repo, que ya rehace la
// envoltura de la DEK con la contrasena nueva; si no rehiciera la envoltura, el
// usuario entraria y se encontraria la base cerrada.
ipcMain.handle('dev:resetearPassword', conPermiso(async (_evt, { usuarioId, password }) => {
  const r = await usuariosRepo.cambiarPassword({ id: usuarioId, password });
  if (r.ok) anotarAuditoria('password_reseteada', 'usuario_id=' + usuarioId);
  return r;
}));

ipcMain.handle('dev:usuarios', conPermiso(() => ({ ok: true, usuarios: usuariosRepo.listar() })));

ipcMain.handle('dev:planes', conPermiso(() => ({ ok: true, planes: mantenimiento.planesConUso() })));

// Borrar un plan que ninguna membresia usa (ver mantenimiento.eliminarPlan).
// Primero se mira si se puede: dejar un respaldo para luego negarse seria llenar
// la carpeta de copias por nada. La comprobacion de verdad se repite dentro de la
// transaccion del borrado.
ipcMain.handle('dev:eliminarPlan', conPermiso(async (_evt, planId) => {
  const previo = mantenimiento.planesConUso().find(p => p.id === planId);
  if (!previo) return { ok: false, motivo: 'plan_no_existe' };
  if (previo.membresias > 0) {
    return { ok: false, motivo: 'plan_con_membresias', membresias: previo.membresias, nombre: previo.nombre };
  }

  const respaldo = await respaldoDeSeguridad();
  const r = mantenimiento.eliminarPlan(planId);
  if (r.ok) anotarAuditoria('plan_eliminado', JSON.stringify(r.plan));
  return { ...r, respaldo };
}));

ipcMain.handle('dev:auditoria', conPermiso((_evt, filtros) => ({
  ok: true,
  filas: mantenimiento.auditoria(filtros),
  acciones: mantenimiento.accionesAuditadas(),
})));

// Sembrar datos de ejemplo. Solo anade; no toca usuarios, config ni cifrado.
// Aun asi deja respaldo antes: si esto cae por error sobre el gimnasio de
// verdad, quedan doce clientes de mentira y tres planes que alguien tiene que
// quitar, y es mas rapido volver al respaldo que ir borrandolos a mano.
ipcMain.handle('dev:sembrarDemo', conPermiso(async () => {
  const respaldo = await respaldoDeSeguridad();

  const db = getDb();
  const dev = db.prepare("SELECT id FROM usuarios WHERE usuario = 'desarrollador'").get();
  if (!dev) return { ok: false, motivo: 'sin_usuario_desarrollador' };

  try {
    const r = require('../services/demo').sembrar({ usuarioId: dev.id });
    anotarAuditoria('datos_demo_sembrados', JSON.stringify(r.creado));
    return { ...r, respaldo };
  } catch (e) {
    return { ok: false, motivo: e.message, respaldo };
  }
}));

module.exports = {};
