const { getDb } = require('../connection');

// Cedula provisional para quien entra sin documento.
//
// Andrey pidio "que la app le asigne una cedula, puede ser 1234". No puede ser
// literalmente 1234 para todos: documento es UNIQUE, asi que el segundo cliente
// sin cedula reventaria. Se usa 1234 como prefijo y cuatro digitos de
// secuencia: 12340001, 12340002...
//
// Los cuatro ultimos digitos son la secuencia, y son justo lo que el kiosco pide
// como "ultimos 4 del documento". Asi el cliente puede marcar asistencia por PIN
// desde el primer dia, aunque su cedula real no se sepa todavia.
//
// Vive aqui y no en el importador de Excel porque ya no es cosa solo del Excel:
// un cliente creado a mano sin cedula tenia el mismo problema y se quedaba sin
// poder entrar al kiosco nunca, sin que nada lo avisara.
const PREFIJO_PROVISIONAL = '1234';

function siguienteDocumentoProvisional() {
  const db = getDb();
  const fila = db.prepare(
    "SELECT MAX(CAST(SUBSTR(documento, 5) AS INTEGER)) AS ultimo FROM clientes " +
    "WHERE documento_provisional = 1 AND documento LIKE '" + PREFIJO_PROVISIONAL + "%'"
  ).get();
  let n = (fila && fila.ultimo ? fila.ultimo : 0);

  // El hueco puede estar ocupado por una cedula real que empiece igual, asi que
  // se sigue avanzando hasta encontrar uno libre en vez de fallar por UNIQUE.
  for (;;) {
    n++;
    const candidato = PREFIJO_PROVISIONAL + String(n).padStart(4, '0');
    const ocupado = db.prepare('SELECT 1 FROM clientes WHERE documento = ?').get(candidato);
    if (!ocupado) return candidato;
  }
}

function crear(cliente) {
  const pedido = String(cliente.documento || '').trim();
  const esProvisional = !pedido;
  const documento = esProvisional ? siguienteDocumentoProvisional() : pedido;
  const ult4 = documento ? documento.slice(-4) : null;
  const info = getDb().prepare(`
    INSERT INTO clientes (documento, documento_ult4, nombre, telefono, email, foto, f_nacimiento, f_registro, pin, contacto_emg, notas, activo, documento_provisional)
    VALUES (@documento, @ult4, @nombre, @telefono, @email, @foto, @f_nacimiento, @f_registro, @pin, @contacto_emg, @notas, 1, @provisional)
  `).run({
    documento,
    ult4,
    provisional: esProvisional ? 1 : 0,
    nombre: cliente.nombre,
    telefono: cliente.telefono || null,
    email: cliente.email || null,
    foto: cliente.foto || null,
    f_nacimiento: cliente.f_nacimiento || null,
    f_registro: new Date().toISOString(),
    pin: null, // el PIN se asigna después (F2)
    contacto_emg: cliente.contacto_emg || null,
    notas: cliente.notas || null,
  });
  return info.lastInsertRowid;
}

function buscar(texto) {
  const like = `%${texto}%`;
  return getDb().prepare(`
    SELECT id, documento, nombre, telefono, activo
    FROM clientes
    WHERE activo = 1 AND (nombre LIKE ? OR documento LIKE ?)
    ORDER BY nombre
    LIMIT 50
  `).all(like, like);
}

function obtenerPorId(id) {
  return getDb().prepare(`SELECT * FROM clientes WHERE id = ?`).get(id);
}

function editar(id, cambios) {
  const pedido = String(cambios.documento || '').trim();

  // Escribirle una cedula distinta a la provisional es, exactamente, lo que el
  // aviso de "le falta el documento" estaba pidiendo. Se quita la marca aqui y
  // no con un boton aparte: nadie va a acordarse de darle a ese boton, y un
  // aviso que no se apaga cuando ya se atendio deja de leerse.
  const actual = getDb().prepare(`SELECT documento, documento_provisional FROM clientes WHERE id = ?`).get(id);
  const eraProvisional = !!(actual && actual.documento_provisional === 1);

  // Guardar con el documento vacio no puede dejar al cliente sin cedula: se le
  // pone una provisional, o conserva la que ya tenia. Sin esto, borrar ese campo
  // -- o un cliente viejo creado sin el -- se quedaba sin poder entrar nunca al
  // kiosco, que pide los ultimos 4 digitos del documento.
  let documento;
  let provisional;
  if (!pedido) {
    documento = eraProvisional && actual.documento ? actual.documento : siguienteDocumentoProvisional();
    provisional = 1;
  } else if (eraProvisional && pedido === actual.documento) {
    documento = pedido;
    provisional = 1;   // no ha cambiado nada: la cedula real sigue sin saberse
  } else {
    documento = pedido;
    provisional = 0;   // escribio una de verdad, se apaga el aviso
  }

  const ult4 = documento.slice(-4);

  getDb().prepare(`
    UPDATE clientes SET
      documento = @documento, documento_ult4 = @ult4, nombre = @nombre,
      telefono = @telefono, email = @email, foto = @foto,
      f_nacimiento = @f_nacimiento, contacto_emg = @contacto_emg, notas = @notas,
      documento_provisional = @provisional
    WHERE id = @id
  `).run({ ...cambios, documento, ult4, id, provisional });
  return true;
}
async function asignarPin(id, pinTextoPlano) {
  const pin = String(pinTextoPlano == null ? '' : pinTextoPlano).trim();
  // El kiosco pide exactamente 4 digitos. Guardar uno de otra longitud dejaria al
  // cliente con un PIN que no puede teclear.
  if (!/^\d{4}$/.test(pin)) return { ok: false, motivo: 'pin_invalido' };

  const argon2 = require('argon2');
  const hash = await argon2.hash(pin);
  const info = getDb().prepare(`UPDATE clientes SET pin = ? WHERE id = ?`).run(hash, id);
  if (info.changes === 0) return { ok: false, motivo: 'no_existe' };
  return { ok: true };
}

// El PIN se guarda con argon2, asi que no se puede "leer" para mostrarlo: lo
// unico que se puede contestar es si el cliente tiene uno o no. Es lo que la
// pantalla necesita para saber si ofrece "Asignar" o "Cambiar".
function tienePin(id) {
  const fila = getDb().prepare(`SELECT pin FROM clientes WHERE id = ?`).get(id);
  return !!(fila && fila.pin);
}

function quitarPin(id) {
  const info = getDb().prepare(`UPDATE clientes SET pin = NULL WHERE id = ?`).run(id);
  return { ok: info.changes > 0 };
}

module.exports = {
  crear, buscar, obtenerPorId, editar, asignarPin, tienePin, quitarPin,
  siguienteDocumentoProvisional, PREFIJO_PROVISIONAL,
};
