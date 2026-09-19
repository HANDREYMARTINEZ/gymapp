const { getDb } = require('../db/connection');
const { cifrarBuffer, descifrarBuffer, obtenerDekEnMemoria } = require('../crypto/dek');

function guardarHuella(clienteId, dedo, templateBuffer) {
  const dek = obtenerDekEnMemoria();
  const cifrado = cifrarBuffer(templateBuffer, dek);
  getDb().prepare(`
    INSERT INTO huellas (cliente_id, dedo, template, creado_en)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cliente_id, dedo) DO UPDATE SET template = excluded.template, creado_en = excluded.creado_en
  `).run(clienteId, dedo, cifrado, new Date().toISOString());
}

// Solo las de clientes activos. Antes iban todas, asi que a un cliente dado de
// baja el kiosco le abria igual con la huella -- por PIN si quedaba fuera,
// porque la identificacion filtra por activo = 1 -- y las dos puertas del
// kiosco aplicaban reglas distintas.
function cargarTodasLasHuellas() {
  const dek = obtenerDekEnMemoria();
  const filas = getDb().prepare(`
    SELECT h.cliente_id, h.template
    FROM huellas h JOIN clientes c ON c.id = h.cliente_id
    WHERE c.activo = 1
  `).all();
  return filas.map(f => ({
    clienteId: f.cliente_id,
    templateBase64: descifrarBuffer(f.template, dek).toString('base64'),
  }));
}

// Que dedos tiene ya registrados este cliente. Se devuelve solo el nombre del
// dedo y la fecha, nunca la plantilla: la pantalla solo necesita saber si hay
// algo para decidir si el boton dice "registrar" o "sustituir", y sacar el dato
// biometrico del proceso principal sin necesitarlo seria regalarlo.
function listarPorCliente(clienteId) {
  return getDb()
    .prepare(`SELECT dedo, creado_en FROM huellas WHERE cliente_id = ? ORDER BY dedo`)
    .all(clienteId);
}

function eliminarHuella(clienteId, dedo) {
  const info = getDb()
    .prepare(`DELETE FROM huellas WHERE cliente_id = ? AND dedo = ?`)
    .run(clienteId, dedo);
  return { ok: true, borradas: info.changes };
}

module.exports = { guardarHuella, cargarTodasLasHuellas, listarPorCliente, eliminarHuella };