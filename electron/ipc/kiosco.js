const { ipcMain } = require('electron');
const { identificarPorDocumentoYPin } = require('../services/identificacion');
const asistenciasRepo = require('../db/repos/asistencias');
const imagenes = require('../services/imagenes');
const { getDb } = require('../db/connection');

// La foto va dentro del mismo resultado y no en una segunda llamada desde la
// pantalla: el kiosco borra el mensaje a los 4 segundos, y pedir la imagen aparte
// la haria aparecer a media cuenta atras, o no aparecer.
//
// El aviso de "a este cliente le falta la cedula" se calcula aqui y no en cada
// pantalla, porque este es el punto por el que pasan los dos caminos del kiosco:
// el PIN y la huella. Puesto en uno solo, el otro no avisaria.
function conFoto(resultado, clienteId) {
  const fila = clienteId
    ? getDb().prepare('SELECT documento, documento_provisional FROM clientes WHERE id = ?').get(clienteId)
    : null;

  return {
    ...resultado,
    clienteId,
    documentoProvisional: !!(fila && fila.documento_provisional),
    documento: fila ? fila.documento : null,
    foto: imagenes.obtener('cliente', clienteId),
  };
}

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

  return conFoto({ ...resultado, nombre: identificacion.nombre }, identificacion.clienteId);
});

module.exports = { conFoto };