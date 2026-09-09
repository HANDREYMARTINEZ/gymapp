const ExcelJS = require('exceljs');
const { format, addDays, parseISO, differenceInCalendarDays } = require('date-fns');
const { getDb } = require('../db/connection');
const membresiasRepo = require('../db/repos/membresias');
const planesRepo = require('../db/repos/planes');

// Exportar e importar clientes y membresias en el mismo formato de ida y vuelta.
//
// El formato no lo invento yo: sale del Excel con el que Andrey lleva el gimnasio
// hoy ("Membresias GYM - 50 clientes"), con las mismas columnas y en el mismo
// orden. Se le anade Documento, que ese archivo no traia y la app necesita para
// saber si dos filas son la misma persona -- por nombre no vale, en 49 clientes
// ya hay dos "Sofia Torres".
//
// El PIN no viaja en el archivo a proposito: es el secreto del cliente para
// entrar al kiosco, y un Excel que circula por correo no es sitio para eso. Tras
// importar, recepcion se lo asigna.

const COLUMNAS = [
  { clave: 'documento', titulo: 'Documento', ancho: 14 },
  { clave: 'nombres', titulo: 'Nombres', ancho: 16 },
  { clave: 'apellidos', titulo: 'Apellidos', ancho: 16 },
  { clave: 'telefono', titulo: 'Telefono', ancho: 14 },
  { clave: 'correo', titulo: 'Correo', ancho: 28 },
  { clave: 'nacimiento', titulo: 'Nacimiento', ancho: 12, fecha: true },
  { clave: 'fInicio', titulo: 'Fecha inicio', ancho: 12, fecha: true },
  { clave: 'fFin', titulo: 'Fecha final', ancho: 12, fecha: true },
  { clave: 'dias', titulo: 'Dias', ancho: 7 },
  { clave: 'estado', titulo: 'Estado', ancho: 15 },
  { clave: 'totalPago', titulo: 'Total pago', ancho: 12, dinero: true },
  { clave: 'saldoRestante', titulo: 'Saldo Restante', ancho: 14, dinero: true },
  { clave: 'metodoPago', titulo: 'Metodo de pago', ancho: 14 },
  { clave: 'tipoMembresia', titulo: 'Tipo Membresia', ancho: 32 },
  { clave: 'tiquetesUsados', titulo: 'Tiquetes Usados', ancho: 14 },
];

const HOJA = 'Clientes';

const ESTADO_EXCEL = {
  activa: 'Activo', por_vencer: 'Activo', programada: 'Programado',
  vencida: 'Vencido', agotada: 'Sin tickets', pausada: 'Pausado',
  saldo_pendiente: 'Con saldo', anulada: 'Anulado',
};

function hoyLocal() {
  return format(new Date(), 'yyyy-MM-dd');
}

// El nombre viaja partido en dos columnas porque asi esta el archivo de Andrey,
// pero la base guarda un solo campo. Al exportar se parte por el primer espacio
// y al importar se vuelve a unir, asi que la ida y vuelta no pierde nada.
function partirNombre(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/);
  if (partes.length === 1) return { nombres: partes[0] || '', apellidos: '' };
  const mitad = partes.length > 3 ? 2 : 1;
  return { nombres: partes.slice(0, mitad).join(' '), apellidos: partes.slice(mitad).join(' ') };
}

function aFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    // ExcelJS devuelve las fechas en UTC. Formatearlas con la zona local corre
    // el dia hacia atras en Colombia y toda membresia importada empezaria un dia
    // antes de lo que dice el archivo.
    return format(new Date(valor.getTime() + valor.getTimezoneOffset() * 60000), 'yyyy-MM-dd');
  }
  const texto = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const conBarras = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (conBarras) {
    const [, d, m, a] = conBarras;
    return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

function aEntero(valor) {
  if (valor == null || valor === '') return 0;
  const n = parseInt(String(valor).replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

function texto(valor) {
  if (valor == null) return '';
  // Una celda con formula o con hipervinculo llega como objeto, no como texto.
  if (typeof valor === 'object') return String(valor.text || valor.result || valor.hyperlink || '').trim();
  return String(valor).trim();
}

// ---------------------------------------------------------------- exportar

function filasParaExportar() {
  const db = getDb();
  const clientes = db.prepare(`SELECT * FROM clientes WHERE activo = 1 ORDER BY nombre`).all();
  const filas = [];

  for (const c of clientes) {
    const { nombres, apellidos } = partirNombre(c.nombre);
    const base = {
      documento: c.documento || '',
      nombres, apellidos,
      telefono: c.telefono || '',
      correo: c.email || '',
      nacimiento: c.f_nacimiento || '',
    };

    const suyas = membresiasRepo.listarPorCliente(c.id).filter(m => !m.anulada);

    // Un cliente sin membresias sale igual, con las columnas de membresia
    // vacias. Si se omitiera, exportar e importar lo borraria del archivo.
    if (suyas.length === 0) {
      filas.push({ ...base, fInicio: '', fFin: '', dias: '', estado: 'Sin membresía',
                   totalPago: '', saldoRestante: '', metodoPago: '', tipoMembresia: '', tiquetesUsados: '' });
      continue;
    }

    for (const m of suyas) {
      const pagos = membresiasRepo.listarPagos(m.id).filter(p => !p.anulada);
      const abonado = pagos.reduce((s, p) => s + p.monto, 0);
      filas.push({
        ...base,
        fInicio: m.f_inicio,
        fFin: m.f_fin || '',
        dias: m.f_fin ? differenceInCalendarDays(parseISO(m.f_fin), parseISO(m.f_inicio)) : '',
        estado: ESTADO_EXCEL[m.estado] || m.estado,
        // "Total pago" es lo abonado y "Saldo Restante" lo que falta: los dos
        // juntos dan el precio. Es como esta el archivo de Andrey, y lo que
        // hace que se pueda volver a importar sin cuentas raras.
        totalPago: abonado,
        saldoRestante: Math.max(0, m.precio_pagado - abonado),
        metodoPago: pagos.length > 0 ? pagos[pagos.length - 1].metodo : '',
        tipoMembresia: m.plan_nombre,
        tiquetesUsados: m.plan_tipo === 'ticketera' ? m.tickets_usados : 0,
      });
    }
  }
  return filas;
}

async function exportarExcel(ruta) {
  const filas = filasParaExportar();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GymApp';
  wb.created = new Date();
  const ws = wb.addWorksheet(HOJA);

  ws.columns = COLUMNAS.map(c => ({ header: c.titulo, key: c.clave, width: c.ancho }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const f of filas) ws.addRow(f);

  for (const [i, c] of COLUMNAS.entries()) {
    if (c.dinero) ws.getColumn(i + 1).numFmt = '#,##0';
  }

  await wb.xlsx.writeFile(ruta);
  return { ok: true, ruta, filas: filas.length };
}

function exportarJson(ruta) {
  const fs = require('fs');
  const filas = filasParaExportar();
  fs.writeFileSync(ruta, JSON.stringify({
    generado: new Date().toISOString(),
    columnas: COLUMNAS.map(c => c.titulo),
    filas,
  }, null, 2), 'utf-8');
  return { ok: true, ruta, filas: filas.length };
}

// ---------------------------------------------------------------- importar

// Los encabezados se buscan por parecido y no por posicion exacta: el archivo de
// Andrey trae espacios de sobra ("Nombres ", "Correo ") y puede traer columnas
// de mas a la derecha. Exigir la posicion clavada convertiria cualquier retoque
// del archivo en un error incomprensible.
function normalizarTitulo(t) {
  return String(t || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function mapearColumnas(fila) {
  const mapa = {};
  fila.eachCell({ includeEmpty: false }, (celda, col) => {
    const t = normalizarTitulo(texto(celda.value));
    const def = COLUMNAS.find(c => normalizarTitulo(c.titulo) === t);
    if (def && mapa[def.clave] == null) mapa[def.clave] = col;
  });
  return mapa;
}

function leerFilas(ruta) {
  return new Promise(async (resolve, reject) => {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(ruta);
      const ws = wb.getWorksheet(HOJA) || wb.worksheets[0];
      if (!ws) return resolve({ ok: false, motivo: 'sin_hojas' });

      const mapa = mapearColumnas(ws.getRow(1));
      // Sin la columna de nombres esto no es el formato, es otro archivo.
      if (!mapa.nombres) return resolve({ ok: false, motivo: 'faltan_columnas', faltan: ['Nombres'] });

      const filas = [];
      for (let n = 2; n <= ws.rowCount; n++) {
        const fila = ws.getRow(n);
        const valor = (clave) => (mapa[clave] ? fila.getCell(mapa[clave]).value : null);
        const documento = texto(valor('documento'));
        const nombres = texto(valor('nombres'));
        // Una hoja de calculo arrastra cientos de filas vacias por debajo de los
        // datos. Sin esto, importar el archivo de Andrey daria 950 errores.
        if (!documento && !nombres) continue;

        filas.push({
          numero: n,
          documento,
          nombre: [nombres, texto(valor('apellidos'))].filter(Boolean).join(' '),
          telefono: texto(valor('telefono')),
          correo: texto(valor('correo')),
          nacimiento: aFecha(valor('nacimiento')),
          fInicio: aFecha(valor('fInicio')),
          fFin: aFecha(valor('fFin')),
          estado: texto(valor('estado')),
          totalPago: aEntero(valor('totalPago')),
          saldoRestante: aEntero(valor('saldoRestante')),
          metodoPago: texto(valor('metodoPago')) || 'Efectivo',
          tipoMembresia: texto(valor('tipoMembresia')),
          tiquetesUsados: aEntero(valor('tiquetesUsados')),
        });
      }
      resolve({ ok: true, filas, mapa });
    } catch (e) {
      reject(e);
    }
  });
}

function validar(fila) {
  // Ya no se rechaza una fila por venir sin documento: se le asigna uno
  // provisional al importarla. Ver documentoProvisional() mas abajo.
  if (!fila.nombre) return 'sin nombre';
  if (fila.tipoMembresia && !fila.fInicio) return 'la membresía no tiene fecha de inicio';
  if (fila.totalPago < 0 || fila.saldoRestante < 0) return 'importes negativos';
  return null;
}

// El plan se busca por nombre exacto. Si ya esta en la base se usa tal cual: es
// el catalogo real del gimnasio y sabe si es de periodo o de tiquetera y cuantos
// tiquetes trae.
//
// Si no esta, hay que inventarlo, y ahi el formato se queda corto: las 15
// columnas dicen cuantos tiquetes se GASTARON pero no cuantos TRAIA la
// ticketera. Se hace la mejor lectura posible del nombre ("... de 15 tiquetes")
// y, cuando ni eso, se deja el numero mas prudente que no contradice los datos.
// Cada plan inventado se avisa, para que alguien lo revise en Planes en vez de
// enterarse cuando a un cliente no le dejen entrar.
function planPara(fila, cache, avisos) {
  const nombre = fila.tipoMembresia;
  if (!nombre) return null;
  if (cache.has(nombre)) return cache.get(nombre);

  const db = getDb();
  let plan = db.prepare(`SELECT * FROM planes WHERE nombre = ?`).get(nombre);

  if (!plan) {
    const precio = fila.totalPago + fila.saldoRestante;
    const enElNombre = nombre.match(/(\d+)\s*(?:tiquete|ticket|clase)/i);
    // Que se hayan gastado tiquetes es prueba de que la membresia los tiene,
    // aunque el nombre no lo diga.
    const esTicketera = !!enElNombre || fila.tiquetesUsados > 0;
    const dias = fila.fInicio && fila.fFin
      ? Math.max(1, differenceInCalendarDays(parseISO(fila.fFin), parseISO(fila.fInicio)))
      : 30;

    let id;
    if (esTicketera) {
      const total = enElNombre ? parseInt(enElNombre[1], 10) : Math.max(fila.tiquetesUsados, 1);
      id = planesRepo.crear({ nombre, tipo: 'ticketera', precio, num_tickets: total, dias_vigencia: dias });
      if (!enElNombre) {
        avisos.push({ plan: nombre, motivo:
          'se creó como ticketera de ' + total + ' tiquetes; el archivo no dice cuántos traía. Revísalo en Planes.' });
      }
    } else {
      id = planesRepo.crear({ nombre, tipo: 'periodo', precio, dias_duracion: dias });
    }
    plan = db.prepare(`SELECT * FROM planes WHERE id = ?`).get(id);
  }

  cache.set(nombre, plan);
  return plan;
}

// La cedula provisional para las filas sin documento la pone el repositorio de
// clientes: es la misma regla que se aplica cuando se crea un cliente a mano, y
// tenerla en dos sitios era pedir que un dia dejaran de coincidir.
const { siguienteDocumentoProvisional } = require('../db/repos/clientes');

async function importarExcel(ruta, { usuarioId } = {}) {
  const lectura = await leerFilas(ruta);
  if (!lectura.ok) return lectura;

  // Un archivo del formato viejo (el que hay hoy en el gimnasio) se lee bien pero
  // no trae Documento, y sin el no hay forma de saber si dos filas son la misma
  // persona. Se dice una vez y claro, en vez de repetir el mismo error 49 veces.
  if (!lectura.mapa.documento) {
    return { ok: false, motivo: 'falta_columna_documento', filas: lectura.filas.length };
  }

  // Antes, si la columna estaba pero vacia, la importacion se paraba entera.
  // Ahora esas filas entran con documento provisional: es preferible tener al
  // cliente dentro y avisar de que le falta la cedula, a no tenerlo.

  const db = getDb();
  const cache = new Map();
  const resultado = {
    ok: true, leidas: lectura.filas.length,
    clientesCreados: 0, clientesActualizados: 0,
    membresiasCreadas: 0, membresiasOmitidas: 0,
    planesCreados: 0, provisionales: 0, errores: [], avisos: [],
  };
  const planesAntes = db.prepare(`SELECT COUNT(*) AS n FROM planes`).get().n;

  for (const fila of lectura.filas) {
    const problema = validar(fila);
    if (problema) {
      resultado.errores.push({ fila: fila.numero, documento: fila.documento, motivo: problema });
      continue;
    }

    try {
      // Toda la fila entra o no entra ninguna parte de ella. A medias dejaria un
      // cliente creado con una membresia que fallo, y al reintentar el archivo
      // saldrian duplicados.
      db.transaction(() => {
        // Una fila sin documento no se puede emparejar por cedula, asi que se
        // busca por nombre exacto ENTRE LOS PROVISIONALES. Sin esto, reimportar
        // el mismo archivo duplicaria cada cliente sin cedula, una copia por
        // pasada. El riesgo -- dos personas sin cedula con el mismo nombre
        // exacto acabarian siendo una -- es pequeno y se deshace escribiendole
        // la cedula real a una de las dos.
        const existente = fila.documento
          ? db.prepare(`SELECT * FROM clientes WHERE documento = ?`).get(fila.documento)
          : db.prepare(`SELECT * FROM clientes WHERE documento_provisional = 1 AND nombre = ?`).get(fila.nombre);
        let clienteId;

        if (existente) {
          // Conflicto = actualiza, como se decidio. Los campos vacios del archivo
          // no pisan lo que ya hay: un Excel al que le falta el correo no deberia
          // borrar el correo que alguien escribio a mano en la app.
          db.prepare(`
            UPDATE clientes SET nombre = ?, telefono = COALESCE(NULLIF(?, ''), telefono),
                   email = COALESCE(NULLIF(?, ''), email),
                   f_nacimiento = COALESCE(?, f_nacimiento)
            WHERE id = ?
          `).run(fila.nombre, fila.telefono, fila.correo, fila.nacimiento, existente.id);
          clienteId = existente.id;
          resultado.clientesActualizados++;
        } else {
          const provisional = !fila.documento;
          const documento = provisional ? siguienteDocumentoProvisional() : fila.documento;

          const info = db.prepare(`
            INSERT INTO clientes (documento, documento_ult4, nombre, telefono, email, f_nacimiento, f_registro, activo, documento_provisional)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
          `).run(documento, documento.slice(-4), fila.nombre,
                 fila.telefono || null, fila.correo || null, fila.nacimiento,
                 new Date().toISOString(), provisional ? 1 : 0);
          clienteId = info.lastInsertRowid;
          resultado.clientesCreados++;
          if (provisional) resultado.provisionales++;
        }

        if (!fila.tipoMembresia) return;

        // Una membresia que ya esta no se duplica. Se reconoce por cliente, plan
        // y fecha de inicio: es lo que hace que reimportar el mismo archivo dos
        // veces no acabe con todo por duplicado.
        const yaEsta = db.prepare(`
          SELECT id FROM membresias
          WHERE cliente_id = ? AND plan_nombre = ? AND f_inicio = ? AND anulada = 0
        `).get(clienteId, fila.tipoMembresia, fila.fInicio);
        if (yaEsta) { resultado.membresiasOmitidas++; return; }

        const plan = planPara(fila, cache, resultado.avisos);
        const precio = fila.totalPago + fila.saldoRestante;
        const esTicketera = plan.tipo === 'ticketera';

        // Si el archivo no dice cuando termina, se calcula con los dias que dura
        // el plan. Sin esto la membresia queda sin fecha de fin y nunca vence:
        // el cliente entraria para siempre con una mensualidad de hace un ano.
        let fFin = fila.fFin;
        if (!fFin && !esTicketera && plan.dias_duracion && fila.fInicio) {
          fFin = format(addDays(parseISO(fila.fInicio), plan.dias_duracion), 'yyyy-MM-dd');
        }

        const info = db.prepare(`
          INSERT INTO membresias (cliente_id, plan_id, plan_nombre, plan_tipo, f_inicio, f_fin,
                                  tickets_totales, tickets_usados, precio_pagado, descuento,
                                  vendida_por, creada_en, anulada)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)
        `).run(clienteId, plan.id, plan.nombre, plan.tipo, fila.fInicio, fFin,
               esTicketera ? Math.max(plan.num_tickets || 0, fila.tiquetesUsados) : null,
               esTicketera ? fila.tiquetesUsados : 0,
               precio, usuarioId || null, new Date().toISOString());
        resultado.membresiasCreadas++;

        // El abono se registra como pago, sin tocar la caja: es dinero que se
        // cobro antes de que existiera la app y meterlo al arqueo de hoy
        // descuadraria el cierre de una caja que no tiene nada que ver.
        if (fila.totalPago > 0) {
          db.prepare(`
            INSERT INTO pagos (membresia_id, monto, metodo, fecha, usuario_id, nota, anulada)
            VALUES (?, ?, ?, ?, ?, 'Importado desde Excel', 0)
          `).run(info.lastInsertRowid, fila.totalPago, fila.metodoPago,
                 (fila.fInicio || hoyLocal()) + 'T12:00:00.000Z', usuarioId || null);
        }
      })();
    } catch (e) {
      resultado.errores.push({ fila: fila.numero, documento: fila.documento, motivo: e.message });
    }
  }

  resultado.planesCreados = db.prepare(`SELECT COUNT(*) AS n FROM planes`).get().n - planesAntes;
  return resultado;
}

module.exports = {
  COLUMNAS, HOJA, exportarExcel, exportarJson, importarExcel, leerFilas, filasParaExportar,
};
