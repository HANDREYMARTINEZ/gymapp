const { ipcMain, BrowserWindow } = require('electron');
const sidecar = require('../services/sidecarHuella');
const huellasRepo = require('../services/huellas');
const asistenciasRepo = require('../db/repos/asistencias');
const clientesRepo = require('../db/repos/clientes');

ipcMain.handle('huellas:enrolar', async (_evt, { clienteId, dedo }) => {
  // El lector es un aparato fisico que puede no estar conectado, y el sidecar un
  // proceso aparte que puede no estar corriendo. Sin este try la promesa se
  // rechaza, la pantalla se queda con el "coloca el dedo" puesto para siempre y
  // el mostrador no sabe si esta esperando o si fallo.
  try {
    const templateBase64 = await sidecar.enrolar(clienteId);
    huellasRepo.guardarHuella(clienteId, dedo, Buffer.from(templateBase64, 'base64'));
    return { ok: true };
  } catch (e) {
    const conocidos = ['sidecar_ajeno', 'lector_atascado'];
    return { ok: false, motivo: conocidos.includes(e.message) ? e.message : 'sin_lector' };
  }
});

ipcMain.handle('huellas:listarPorCliente', (_evt, clienteId) => huellasRepo.listarPorCliente(clienteId));
ipcMain.handle('huellas:eliminar', (_evt, clienteId, dedo) => huellasRepo.eliminarHuella(clienteId, dedo));

ipcMain.handle('kiosco:iniciarEscuchaHuella', async (evt) => {
  const templates = huellasRepo.cargarTodasLasHuellas();
  const ventana = evt.sender;

  await sidecar.iniciarVerificacion(templates, async (clienteId) => {
    const resultado = asistenciasRepo.registrar({ clienteId, metodo: 'huella', registradoPor: null });
    const cliente = clientesRepo.obtenerPorId(clienteId);
    const { respuestaKiosco } = require('./kiosco');
    // Si el lector se dispara justo cuando el usuario cierra la ventana, el
    // send() sobre un sender destruido lanza -- y aqui no hay nadie arriba que
    // lo recoja, porque esto lo llama el sidecar, no una promesa de la pantalla.
    try {
      ventana.send('kiosco:huellaDetectada',
        await respuestaKiosco({ ...resultado, nombre: cliente ? cliente.nombre : null }, clienteId, 'huella'));
    } catch (e) { /* ventana cerrada a media lectura */ }
  });

  return { ok: true, cantidad: templates.length };
});

// La pareja de la anterior: la llama el kiosco al salir de su pantalla. Sin
// esto el lector seguia armado en todas las demas.
ipcMain.handle('kiosco:detenerEscuchaHuella', () => {
  try { sidecar.detenerVerificacion(); } catch (e) {}
  return { ok: true };
});

// El atasco del lector se reparte a todas las ventanas: lo pinta el kiosco, que
// es donde se nota, pero no depende de que este abierto en ese momento.
sidecar.onCambioAtasco((atascado) => {
  for (const v of BrowserWindow.getAllWindows()) {
    try { v.webContents.send('huellas:atasco', atascado); } catch (e) { /* ventana cerrandose */ }
  }
});

ipcMain.handle('huellas:estaAtascado', () => sidecar.estaAtascado());

module.exports = {};