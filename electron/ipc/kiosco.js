const { ipcMain } = require('electron');
const { identificarPorDocumentoYPin } = require('../services/identificacion');
const asistenciasRepo = require('../db/repos/asistencias');
const imagenes = require('../services/imagenes');
const { getDb } = require('../db/connection');
const puerta = require('../services/puerta');

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

// El unico sitio del proyecto donde se abre la puerta por una asistencia.
//
// Va aqui y no dentro de asistenciasRepo.registrar() a proposito: por ese repo
// pasan tambien las asistencias que teclea recepcion a mano, y esas no tienen
// por que abrir la calle -- quien las teclea ya tiene a la persona delante y la
// puerta a un metro. Aqui solo pasan los dos caminos del kiosco.
//
// Se abre en dos casos, y ninguno decide aqui quien entra:
//
//   - resultado.ok: la asistencia de hoy se acaba de registrar. Esa bandera ya
//     trae dentro toda la regla de negocio (vigente, sin saldo, con tiquete).
//   - reingreso: el cliente YA marco hoy y vuelve (salio al carro). Lo decide
//     puedeReingresar(), en membresias-logica, junto a puedeEntrenar(). Ni crea
//     otra asistencia ni gasta otro tiquete.
//
// El reingreso fue decision de Andrey del 12-sep-2026, con PIN y con huella. El
// riesgo que se acepto: quien preste su PIN puede dejar pasar a otro despues de
// el, y esa entrada no crea asistencia. Por eso cada reingreso queda anotado en
// auditoria con la hora: no bloquea a nadie, pero no es invisible.
async function respuestaKiosco(resultado, clienteId, metodo) {
  if (!resultado.ok && resultado.motivo === 'ya_registrado_hoy' && clienteId) {
    const re = asistenciasRepo.evaluarReingreso(clienteId);

    if (re.ok) {
      const { motivo, ...sinMotivo } = resultado;
      const salida = conFoto({ ...sinMotivo, ok: true, reingreso: true,
                               membresiaId: re.membresiaId, estado: re.estado }, clienteId);
      salida.puerta = await puerta.abrirSiProcede();
      anotarReingreso(clienteId, metodo, re.membresiaId, salida.puerta);
      return salida;
    }

    // Vino hoy, pero despues recepcion le anulo o le pauso la membresia: se dice
    // el motivo real, no "ya registraste tu asistencia", que no explicaria por
    // que la puerta no abre.
    if (re.motivo !== 'ya_registrado_hoy' && re.motivo !== 'sin_asistencia_hoy') {
      return conFoto({ ...resultado, motivo: re.motivo }, clienteId);
    }
  }

  const salida = conFoto(resultado, clienteId);
  if (!salida.ok) return salida;
  salida.puerta = await puerta.abrirSiProcede();
  return salida;
}

function anotarReingreso(clienteId, metodo, membresiaId, estadoPuerta) {
  try {
    getDb().prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (NULL, 'kiosco_reingreso', 'clientes', ?, ?, ?)
    `).run(clienteId, new Date().toISOString(),
           JSON.stringify({ metodo: metodo || null, membresiaId, puerta: estadoPuerta }));
  } catch (e) {
    // Que falle la anotacion no puede dejar a alguien fuera: la puerta ya se
    // abrio y el cliente esta delante.
  }
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

  return respuestaKiosco({ ...resultado, nombre: identificacion.nombre }, identificacion.clienteId, 'pin');
});

module.exports = { conFoto, respuestaKiosco };