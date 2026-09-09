const { getDb } = require('../connection');

// El nombre se guarda recortado, siempre.
//
// El catalogo real llego lleno de nombres con espacio al final ("Dia ",
// "Anual "), heredados del Excel del gimnasio. Eso no se ve en pantalla y sin
// embargo hace dano: dos planes que parecen el mismo, y una reimportacion que no
// reconocia las membresias ya existentes. Se recorta aqui, en la unica puerta
// por la que entran nombres de plan, para que no vuelva a colarse ninguno.
function limpiarNombre(nombre) {
  return String(nombre == null ? '' : nombre).trim();
}

// Para agrupar los que son "el mismo plan escrito de otra forma": sin espacios,
// sin mayusculas y sin tildes. Asi "Dia ", "Dia" y "Dia" con tilde caen juntos,
// que es exactamente lo que hay que ver antes de decidir cual se queda.
function nombreNormalizado(nombre) {
  return limpiarNombre(nombre).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function crear(plan) {
  const info = getDb().prepare(`
    INSERT INTO planes (nombre, tipo, precio, dias_duracion, num_tickets, dias_vigencia, color, activo)
    VALUES (@nombre, @tipo, @precio, @dias_duracion, @num_tickets, @dias_vigencia, @color, 1)
  `).run({
    nombre: limpiarNombre(plan.nombre),
    tipo: plan.tipo,
    precio: plan.precio,
    dias_duracion: plan.tipo === 'periodo' ? plan.dias_duracion : null,
    num_tickets: plan.tipo === 'ticketera' ? plan.num_tickets : null,
    dias_vigencia: plan.tipo === 'ticketera' ? (plan.dias_vigencia || null) : null,
    color: plan.color || null,
  });
  return info.lastInsertRowid;
}

function listar() {
  return getDb().prepare(`SELECT * FROM planes WHERE activo = 1 ORDER BY nombre`).all();
}

function obtenerPorId(id) {
  return getDb().prepare(`SELECT * FROM planes WHERE id = ?`).get(id);
}

function editar(id, cambios) {
  getDb().prepare(`
    UPDATE planes SET
      nombre = @nombre, precio = @precio,
      dias_duracion = @dias_duracion, num_tickets = @num_tickets,
      dias_vigencia = @dias_vigencia, color = @color
    WHERE id = @id
  `).run({ ...cambios, nombre: limpiarNombre(cambios.nombre), id });
  return true;
}

function desactivar(id) {
  getDb().prepare(`UPDATE planes SET activo = 0 WHERE id = ?`).run(id);
  return true;
}

function activar(id) {
  getDb().prepare(`UPDATE planes SET activo = 1 WHERE id = ?`).run(id);
  return true;
}

// El catalogo con lo que cuelga de cada plan y con los problemas de su nombre.
//
// Desactivar o renombrar a ciegas es lo que da miedo, y era lo que habia hasta
// ahora: la pantalla solo decia nombre, precio y duracion. Con esto se ve si un
// plan lo esta usando alguien HOY (entonces no se toca), si solo tiene historia
// (se puede desactivar sin ruido) o si no se ha usado nunca (se puede borrar de
// la vista sin pensarlo).
//
// "En uso" no se decide aqui con un CASE WHEN: se reutiliza cargarEstados(), que
// es la misma definicion de vencida/activa/pausada que usan el kiosco, la ficha
// del cliente y los recordatorios. Dos definiciones de "vencida" dejan de
// coincidir a la primera.
function listarTodos() {
  const db = getDb();
  const planes = db.prepare(`SELECT * FROM planes ORDER BY activo DESC, nombre`).all();

  // Historico: todas las membresias no anuladas, sean de quien sean.
  const historico = new Map(
    db.prepare(`
      SELECT plan_id, COUNT(*) AS total, MAX(f_inicio) AS ultima
      FROM membresias WHERE anulada = 0 GROUP BY plan_id
    `).all().map(r => [r.plan_id, r])
  );

  // En uso hoy: solo clientes activos, y solo membresias que no estan vencidas
  // ni agotadas. Una vencida no es motivo para no tocar el plan.
  const { cargarEstados } = require('./panel-clientes');
  const enUso = new Map();
  for (const susMembresias of cargarEstados().values()) {
    for (const m of susMembresias) {
      if (m.estado === 'vencida' || m.estado === 'agotada' || m.estado === 'anulada') continue;
      enUso.set(m.plan_id, (enUso.get(m.plan_id) || 0) + 1);
    }
  }

  // Los que son el mismo plan escrito de otra forma. Se agrupan, no se tocan:
  // cual sobrevive lo decide quien lleva el gimnasio, no el programa.
  const porNombre = new Map();
  for (const p of planes) {
    const clave = nombreNormalizado(p.nombre);
    if (!porNombre.has(clave)) porNombre.set(clave, []);
    porNombre.get(clave).push(p.id);
  }

  return planes.map(p => {
    const h = historico.get(p.id);
    const gemelos = porNombre.get(nombreNormalizado(p.nombre)).filter(id => id !== p.id);
    return {
      ...p,
      membresiasEnUso: enUso.get(p.id) || 0,
      membresiasHistorico: h ? h.total : 0,
      ultimaVenta: h ? h.ultima : null,
      // Los dos avisos que hay que ver antes de decidir nada.
      nombreConEspacios: p.nombre !== p.nombre.trim(),
      gemelos,
    };
  });
}

module.exports = {
  crear, listar, listarTodos, obtenerPorId, editar, desactivar, activar,
  limpiarNombre, nombreNormalizado,
};

