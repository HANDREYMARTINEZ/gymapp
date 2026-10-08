const { ipcMain, BrowserWindow } = require('electron');
const sidecar = require('../services/sidecarHuella');
const huellasRepo = require('../services/huellas');
const asistenciasRepo = require('../db/repos/asistencias');
const clientesRepo = require('../db/repos/clientes');
const escuchaKiosco = require('../services/escuchaKiosco');

ipcMain.handle('huellas:enrolar', async (_evt, { clienteId, dedo }) => {
  // Con la segunda pantalla el kiosco puede estar escuchando mientras recepcion
  // enrola. El lector es uno: se reserva, los kioscos avisan de que esta ocupado,
  // y al terminar se vuelve a armar ya con la huella nueva dentro.
  const reserva = escuchaKiosco.reservar();
  await reserva.desarmado;
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
  } finally {
    reserva.soltar();
  }
});

ipcMain.handle('huellas:listarPorCliente', (_evt, clienteId) => huellasRepo.listarPorCliente(clienteId));
ipcMain.handle('huellas:eliminar', (_evt, clienteId, dedo) => {
  const r = huellasRepo.eliminarHuella(clienteId, dedo);
  // El sidecar guarda su propia copia de las huellas: sin recargarla, la borrada
  // seguiria entrando por la segunda pantalla hasta reiniciar la app.
  escuchaKiosco.recargar();
  return r;
});

// Lo que pasa cuando el lector reconoce a alguien. Se resuelve una sola vez
// aunque haya dos kioscos abiertos (ventana principal y segunda pantalla): una
// asistencia, un pulso de puerta, y el mismo mensaje a los dos.
escuchaKiosco.alResolver(async (clienteId) => {
  const resultado = asistenciasRepo.registrar({ clienteId, metodo: 'huella', registradoPor: null });
  const cliente = clientesRepo.obtenerPorId(clienteId);
  const { respuestaKiosco } = require('./kiosco');
  return respuestaKiosco({ ...resultado, nombre: cliente ? cliente.nombre : null }, clienteId, 'huella');
});

ipcMain.handle('kiosco:iniciarEscuchaHuella', (evt) => escuchaKiosco.apuntar(evt.sender));

// La pareja de la anterior: la llama el kiosco al salir de su pantalla. Solo
// borra a ESA ventana: si la segunda pantalla sigue abierta, el lector sigue
// armado para ella.
ipcMain.handle('kiosco:detenerEscuchaHuella', async (evt) => {
  try { await escuchaKiosco.borrar(evt.sender); } catch (e) {}
  return { ok: true };
});

ipcMain.handle('kiosco:lectorOcupado', () => escuchaKiosco.estaOcupado());

// El atasco del lector se reparte a todas las ventanas: lo pinta el kiosco, que
// es donde se nota, pero no depende de que este abierto en ese momento.
sidecar.onCambioAtasco((atascado) => {
  for (const v of BrowserWindow.getAllWindows()) {
    try { v.webContents.send('huellas:atasco', atascado); } catch (e) { /* ventana cerrandose */ }
  }
});

ipcMain.handle('huellas:estaAtascado', () => sidecar.estaAtascado());

module.exports = {};