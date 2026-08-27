const { ipcMain } = require('electron');
const { identificarPorDocumentoYPin } = require('../services/identificacion');
const asistenciasRepo = require('../db/repos/asistencias');

ipcMain.handle('kiosco:marcarPorPin', async (_evt, { ult4, pin }) => {
  const identificacion = await identificarPorDocumentoYPin(ult4, pin);
  if (!identificacion.ok) {
    return { ok: false, motivo: identificacion.motivo };
  }

  const resultado = asistenciasRepo.registrar({
    clienteId: identificacion.clienteId,
    metodo: 'pin',
    registradoPor: null,
  });

  return { ...resultado, nombre: identificacion.nombre };
});

module.exports = {};