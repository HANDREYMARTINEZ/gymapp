const { getDb } = require('../connection');
const { normalizarBusqueda } = require('../texto');

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

// Quien tiene ya esa cedula, si la tiene alguien.
//
// `documento` es UNIQUE, asi que guardar una repetida revienta con un error de
// SQLite que subia crudo hasta la pantalla: el formulario se quedaba en
// "Guardando..." para siempre y ni siquiera dejaba cancelar. Se comprueba antes
// y se contesta con el nombre del que ya la tiene, que es lo que necesita quien
// esta en el mostrador -- casi siempre es la misma persona, ya registrada.
function duenoDelDocumento(documento, exceptoId) {
  if (!documento) return null;
  return exceptoId
    ? getDb().prepare(`SELECT id, nombre, activo FROM clientes WHERE documento = ? AND id != ?`).get(documento, exceptoId)
    : getDb().prepare(`SELECT id, nombre, activo FROM clientes WHERE documento = ?`).get(documento);
}

function duplicado(dueno) {
  return {
    ok: false,
    motivo: 'documento_duplicado',
    clienteId: dueno.id,
    nombre: dueno.nombre,
    activo: dueno.activo === 1,
  };
}

// Devuelve el id nuevo (un numero) cuando todo va bien, y un objeto
// { ok: false, motivo } cuando la cedula ya es de otro. Quien llame tiene que
// mirar si lo que recibe es un numero.
function crear(cliente) {
  const pedido = String(cliente.documento || '').trim();
  const esProvisional = !pedido;

  const dueno = duenoDelDocumento(pedido);
  if (dueno) return duplicado(dueno);

  const documento = esProvisional ? siguienteDocumentoProvisional() : pedido;
  const ult4 = documento ? documento.slice(-4) : null;
  const info = getDb().prepare(`
    INSERT INTO clientes (documento, documento_ult4, nombre, nombre_busqueda, telefono, email, foto, f_nacimiento, f_registro, pin, contacto_emg, notas, activo, documento_provisional)
    VALUES (@documento, @ult4, @nombre, @nombreBusqueda, @telefono, @email, @foto, @f_nacimiento, @f_registro, @pin, @contacto_emg, @notas, 1, @provisional)
  `).run({
    documento,
    ult4,
    provisional: esProvisional ? 1 : 0,
    nombre: cliente.nombre,
    nombreBusqueda: normalizarBusqueda(cliente.nombre),
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

// En el mostrador el nombre es la referencia principal, no la cedula: la
// busqueda tiene que encontrar por nombre, por apellido, por el nombre completo
// o por cualquier trozo, escrito como se escriba. Contra nombre_busqueda se
// compara ya sin tildes y en minusculas; se deja tambien la comparacion contra
// el nombre crudo por si alguna fila vieja no tuviera la columna rellena.
function buscar(texto) {
  const like = `%${texto}%`;
  const likeNorm = `%${normalizarBusqueda(texto)}%`;
  return getDb().prepare(`
    SELECT id, documento, nombre, telefono, activo
    FROM clientes
    WHERE activo = 1
      AND (nombre_busqueda LIKE ? OR nombre LIKE ? OR documento LIKE ?)
    ORDER BY nombre
    LIMIT 50
  `).all(likeNorm, like, like);
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

  // Lo mismo que en crear(): la cedula de otro no puede llegar al UNIQUE.
  const dueno = duenoDelDocumento(pedido, id);
  if (dueno) return duplicado(dueno);

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
      nombre_busqueda = @nombreBusqueda,
      telefono = @telefono, email = @email, foto = @foto,
      f_nacimiento = @f_nacimiento, contacto_emg = @contacto_emg, notas = @notas,
      documento_provisional = @provisional
    WHERE id = @id
  `).run({ ...cambios, documento, ult4, id, provisional,
           nombreBusqueda: normalizarBusqueda(cambios.nombre) });
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

// Asignacion del PIN en lote, para los clientes que llegaron por el Excel: el
// archivo no trae PIN a proposito, asi que los 109 importados entraron sin uno y
// sin PIN no pueden marcar asistencia en el kiosco. Ponerselos a mano es una
// tarde entera.
//
// El kiosco identifica por ULTIMOS 4 DEL DOCUMENTO + PIN, no por el PIN solo, asi
// que un PIN comun no vuelve ambiguo a nadie mientras no haya dos clientes con
// los mismos cuatro digitos finales. Los que si coincidan se devuelven en
// `choques` para que la pantalla los cante: a esos hay que darles otro PIN.
// Con `aleatorio` cada cliente recibe un PIN distinto y la funcion los devuelve
// UNA sola vez, en claro, para poder imprimirlos: despues ya no hay forma de
// leerlos -- se guardan con argon2 y eso no se deshace.
async function asignarPinEnLote({ pin, usuarioId, incluirConPin = false, aleatorio = false } = {}) {
  const limpio = String(pin == null ? '' : pin).trim();
  if (!aleatorio && !/^\d{4}$/.test(limpio)) return { ok: false, motivo: 'pin_invalido' };

  const db = getDb();
  const candidatos = db.prepare(`
    SELECT id, nombre, documento, documento_ult4 FROM clientes
    WHERE activo = 1 ${incluirConPin ? '' : 'AND (pin IS NULL OR pin = \'\')'}
    ORDER BY nombre
  `).all();

  if (candidatos.length === 0) return { ok: true, asignados: 0, choques: [], generados: [] };

  // Con un PIN comun basta un hash reutilizado: con argon2 por cliente esto
  // serian decenas de segundos con el proceso principal bloqueado, y no
  // compraria nada -- el PIN es literalmente el mismo secreto para todos, asi
  // que una sal por cliente no esconde nada que no se sepa ya. Con PIN aleatorio
  // no hay atajo posible: cada uno es un secreto distinto y lleva su hash.
  const argon2 = require('argon2');
  const crypto = require('crypto');
  const hashComun = aleatorio ? null : await argon2.hash(limpio);

  const generados = [];
  const hashes = new Map();
  if (aleatorio) {
    for (const c of candidatos) {
      // randomInt del modulo crypto, no Math.random: es la llave de entrada del
      // cliente al gimnasio, por pequena que sea.
      const suyo = String(crypto.randomInt(0, 10000)).padStart(4, '0');
      hashes.set(c.id, await argon2.hash(suyo));
      generados.push({ id: c.id, nombre: c.nombre, documento: c.documento, pin: suyo });
    }
  }

  // Solo importa con PIN comun: si cada uno tiene el suyo, dos clientes con los
  // mismos 4 digitos finales se distinguen igual por el PIN.
  const choques = [];
  if (!aleatorio) {
    const porUlt4 = new Map();
    for (const c of candidatos) {
      const u = c.documento_ult4 || '';
      if (!porUlt4.has(u)) porUlt4.set(u, []);
      porUlt4.get(u).push({ id: c.id, nombre: c.nombre, documento: c.documento });
    }
    for (const [ult4, lista] of porUlt4) {
      if (lista.length > 1) choques.push({ ult4, clientes: lista });
    }
  }

  db.transaction(() => {
    const poner = db.prepare(`UPDATE clientes SET pin = ? WHERE id = ?`);
    for (const c of candidatos) poner.run(aleatorio ? hashes.get(c.id) : hashComun, c.id);
    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'clientes_pin_lote', 'clientes', NULL, ?, ?)
    `).run(usuarioId || null, new Date().toISOString(),
           JSON.stringify({ asignados: candidatos.length,
                            aleatorio: !!aleatorio,
                            incluirConPin: !!incluirConPin,
                            choquesUlt4: choques.length }));
  })();

  // Los PIN en claro NO se anotan en auditoria: viajan a la pantalla, se
  // imprimen y ahi se acaban.
  return { ok: true, asignados: candidatos.length, choques, generados };
}

// Lo que la pantalla necesita para decidir si ofrece el lote y con que numero:
// cuantos clientes activos hay y a cuantos les falta el PIN.
function pinesResumen() {
  const f = getDb().prepare(`
    SELECT COUNT(*) AS activos,
           SUM(CASE WHEN pin IS NULL OR pin = '' THEN 1 ELSE 0 END) AS sinPin
    FROM clientes WHERE activo = 1
  `).get();
  const activos = f.activos || 0;
  const sinPin = f.sinPin || 0;
  return { activos, sinPin, conPin: activos - sinPin };
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

// ------------------------------------------------------------- dar de baja

// Dar de baja NO borra nada. Solo apaga el interruptor `activo`, que toda la app
// ya respetaba desde el principio -- la busqueda, el panel de Clientes, el censo
// de correos, la ronda de recordatorios y la identificacion del kiosco filtran
// por activo = 1 -- pero que hasta hoy no habia forma de apagar desde la app.
//
// Es lo que faltaba para poder quitar de en medio a alguien sin perder lo que
// pago. Lo unico que existia era vaciar la zona de clientes entera desde el
// panel de desarrollador, que se lleva a TODOS por delante.
//
// Se anota en auditoria, como la anulacion de una membresia: quien, cuando y por
// que. Y se puede deshacer.
function darDeBaja({ clienteId, usuarioId, motivo } = {}) {
  const db = getDb();
  const cliente = db.prepare(`SELECT id, nombre, activo FROM clientes WHERE id = ?`).get(clienteId);
  if (!cliente) return { ok: false, motivo: 'no_existe' };
  if (cliente.activo === 0) return { ok: true, yaEstaba: true };

  // Cuantas membresias suyas siguen vivas. No lo impide -- puede que alguien
  // pague y desaparezca al dia siguiente -- pero la pantalla tiene que poder
  // avisarlo antes, y queda escrito en auditoria.
  const { cargarEstados } = require('./panel-clientes');
  const suyas = (cargarEstados().get(clienteId) || [])
    .filter(m => !['vencida', 'agotada', 'anulada'].includes(m.estado));

  db.transaction(() => {
    db.prepare(`UPDATE clientes SET activo = 0 WHERE id = ?`).run(clienteId);
    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'cliente_baja', 'clientes', ?, ?, ?)
    `).run(usuarioId || null, clienteId, new Date().toISOString(),
           JSON.stringify({ nombre: cliente.nombre, motivo: motivo || null,
                            membresiasVivas: suyas.length }));
  })();

  return { ok: true, membresiasVivas: suyas.length };
}

function reactivar({ clienteId, usuarioId } = {}) {
  const db = getDb();
  const cliente = db.prepare(`SELECT id, nombre, activo FROM clientes WHERE id = ?`).get(clienteId);
  if (!cliente) return { ok: false, motivo: 'no_existe' };
  if (cliente.activo === 1) return { ok: true, yaEstaba: true };

  db.transaction(() => {
    db.prepare(`UPDATE clientes SET activo = 1 WHERE id = ?`).run(clienteId);
    db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, fecha, detalle)
      VALUES (?, 'cliente_reactivado', 'clientes', ?, ?, ?)
    `).run(usuarioId || null, clienteId, new Date().toISOString(),
           JSON.stringify({ nombre: cliente.nombre }));
  })();

  return { ok: true };
}

// Sin esto, dar de baja seria una puerta de un solo sentido: el cliente
// desaparece de la busqueda y ya no hay forma de encontrarlo para deshacerlo.
// Se devuelve la fecha y el motivo que quedaron en auditoria, que es lo que
// permite reconocer al que se dio de baja por error.
function listarDadosDeBaja() {
  return getDb().prepare(`
    SELECT c.id, c.documento, c.nombre, c.telefono, c.email,
           -- 'localtime': la auditoria guarda UTC, y sin esto una baja hecha de
           -- noche en UTC-5 se muestra con la fecha del dia siguiente.
           date(a.fecha, 'localtime') AS fechaBaja, a.detalle AS detalleBaja
    FROM clientes c
    LEFT JOIN auditoria a ON a.id = (
      SELECT MAX(id) FROM auditoria
      WHERE entidad = 'clientes' AND entidad_id = c.id AND accion = 'cliente_baja'
    )
    WHERE c.activo = 0
    ORDER BY c.nombre
  `).all().map(f => {
    let motivo = null;
    try { motivo = JSON.parse(f.detalleBaja || '{}').motivo || null; } catch (e) {}
    return {
      id: f.id, documento: f.documento, nombre: f.nombre,
      telefono: f.telefono, email: f.email,
      fechaBaja: f.fechaBaja, motivo,
    };
  });
}

module.exports = {
  crear, buscar, obtenerPorId, editar, asignarPin, tienePin, quitarPin,
  asignarPinEnLote, pinesResumen,
  darDeBaja, reactivar, listarDadosDeBaja,
  siguienteDocumentoProvisional, PREFIJO_PROVISIONAL,
};
