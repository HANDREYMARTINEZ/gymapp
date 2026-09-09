const { ipcMain } = require('electron');
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
    return { ok: false, motivo: e.message === 'sidecar_ajeno' ? 'sidecar_ajeno' : 'sin_lector' };
  }
});

ipcMain.handle('huellas:listarPorCliente', (_evt, clienteId) => huellasRepo.listarPorCliente(clienteId));
ipcMain.handle('huellas:eliminar', (_evt, clienteId, dedo) => huellasRepo.eliminarHuella(clienteId, dedo));

ipcMain.handle('kiosco:iniciarEscuchaHuella', async (evt) => {
  const templates = huellasRepo.cargarTodasLasHuellas();
  const ventana = evt.sender;

  await sidecar.iniciarVerificacion(templates, (clienteId) => {
    const resultado = asistenciasRepo.registrar({ clienteId, metodo: 'huella', registradoPor: null });
    const cliente = clientesRepo.obtenerPorId(clienteId);
    const { conFoto } = require('./kiosco');
    ventana.send('kiosco:huellaDetectada',
      conFoto({ ...resultado, nombre: cliente ? cliente.nombre : null }, clienteId));
  });

  return { ok: true, cantidad: templates.length };
});

module.exports = {};