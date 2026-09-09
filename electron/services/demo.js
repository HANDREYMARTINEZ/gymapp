const { format, addDays } = require('date-fns');
const { getDb } = require('../db/connection');

// Datos de ejemplo para demos y para reproducir fallos con la app llena.
//
// Esto ya existia en scripts/capturas.js, pero solo se podia disparar desde la
// terminal y contra una base temporal. Aqui se puede desde dentro, y por eso hay
// una diferencia que importa: aquel seed montaba la instalacion entera --
// usuarios, passphrase, llaves de cifrado -- y este NO toca nada de eso.
// Sembrar sobre un gimnasio de verdad no le puede cambiar quien entra ni con que
// contrasena; solo le mete clientes y ventas de mentira que despues se quitan
// desde "Vaciar datos".
//
// Los clientes de ejemplo llevan documento 99xxxxxx a proposito: es un rango que
// ninguna cedula real ocupa, asi que si un dia aparece uno en un gimnasio en
// produccion, se sabe de donde salio.
const PREFIJO_DOC = '99';

const NOMBRES = [
  'Carolina Ríos', 'Andrés Gómez', 'Marcela Duque', 'Julián Pérez',
  'Sofía Ramírez', 'Camilo Ospina', 'Valeria Cano', 'Mateo Restrepo',
  'Isabela Torres', 'Samuel Arango', 'Daniela Vélez', 'Tomás Jaramillo',
];

// Las asistencias de los ultimos dias son lo que hace que el dashboard tenga
// algo que dibujar. Un cliente solo puede marcar una vez al dia (indice unico),
// asi que el dia mas concurrido no puede pedir mas clientes de los que hay.
const ASISTENCIAS_POR_DIA = [7, 4, 9, 6, 11, 3];

function sembrar({ usuarioId }) {
  const db = getDb();
  const planes = require('../db/repos/planes');
  const clientes = require('../db/repos/clientes');
  const productos = require('../db/repos/productos');
  const membresias = require('../db/repos/membresias');
  const ventas = require('../db/repos/ventas');
  const asistencias = require('../db/repos/asistencias');
  const caja = require('../db/repos/caja');

  const creado = {
    planes: 0, clientes: 0, productos: 0, membresias: 0,
    ventas: 0, asistencias: 0, cajaAbierta: false,
  };

  // Sembrar dos veces seguidas es lo normal cuando se esta probando algo, asi
  // que la segunda tanda continua la numeracion en vez de chocar con el
  // documento, que es UNIQUE. La tanda va tambien en el nombre para que en la
  // lista de clientes se vea cual es cual.
  const yaSembrados = db.prepare(
    "SELECT COUNT(*) AS n FROM clientes WHERE documento LIKE '" + PREFIJO_DOC + "%'"
  ).get().n;
  const tanda = Math.floor(yaSembrados / NOMBRES.length) + 1;
  const sufijo = tanda > 1 ? ' ' + tanda : '';

  const todoDeUnaVez = db.transaction(() => {
    const mensual = planes.crear({ nombre: 'Mensual (demo' + sufijo + ')', tipo: 'periodo', precio: 120000, dias_duracion: 30, color: '#ffe500' });
    planes.crear({ nombre: 'Trimestral (demo' + sufijo + ')', tipo: 'periodo', precio: 320000, dias_duracion: 90, color: '#51cf66' });
    planes.crear({ nombre: 'Diez clases (demo' + sufijo + ')', tipo: 'ticketera', precio: 90000, num_tickets: 10, dias_vigencia: 60, color: '#ffa94d' });
    creado.planes = 3;

    const ids = NOMBRES.map((nombre, i) => {
      const orden = yaSembrados + i;
      const id = clientes.crear({
        documento: PREFIJO_DOC + String(100000 + orden),
        nombre: nombre + sufijo,
        telefono: '31' + String(10000000 + orden),
      });
      creado.clientes++;
      return id;
    });

    const agua = productos.crear({ nombre: 'Agua 600ml (demo' + sufijo + ')', categoria: 'Bebidas', p_venta: 3000, p_costo: 1800, stock: 24, stock_min: 6 }).id;
    productos.crear({ nombre: 'Barra proteica (demo' + sufijo + ')', categoria: 'Snacks', p_venta: 6500, p_costo: 4000, stock: 3, stock_min: 8 });
    productos.crear({ nombre: 'Toalla (demo' + sufijo + ')', categoria: 'Accesorios', p_venta: 25000, p_costo: 14000, stock: 1, stock_min: 4 });
    creado.productos = 3;

    // Si el gimnasio ya tiene su caja abierta se respeta: abrir una segunda
    // dejaria el arqueo sin cuadrar, y el repo lo rechaza de todos modos.
    const abierta = caja.abrir({ usuarioId, baseInicial: 50000 });
    creado.cajaAbierta = abierta.ok;

    // Una membresia por vencer y otra recien vendida: son los dos casos que el
    // panel de clientes y el dashboard pintan distinto, y sin ellos la demo se
    // ve toda igual.
    const m1 = membresias.vender({ clienteId: ids[0], planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: m1, monto: 120000, metodo: 'Efectivo', usuarioId });
    db.prepare('UPDATE membresias SET f_fin = ? WHERE id = ?')
      .run(format(addDays(new Date(), 3), 'yyyy-MM-dd'), m1);

    const m2 = membresias.vender({ clienteId: ids[1], planId: mensual, usuarioId });
    membresias.registrarPago({ membresiaId: m2, monto: 120000, metodo: 'Tarjeta', usuarioId });
    creado.membresias = 2;

    ventas.registrar({ items: [{ productoId: agua, cantidad: 2 }], metodoPago: 'Efectivo', usuarioId });
    ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Tarjeta', usuarioId });
    creado.ventas = 2;

    asistencias.registrar({ clienteId: ids[0], metodo: 'manual', registradoPor: usuarioId });
    asistencias.registrar({ clienteId: ids[1], metodo: 'manual', registradoPor: usuarioId });
    creado.asistencias = 2;

    // Las de dias pasados van por SQL directo: el repo registra siempre "ahora",
    // que es lo correcto para el mostrador pero no sirve para dibujar la semana.
    // El OR IGNORE respeta el indice unico por cliente y dia, asi que sembrar dos
    // veces no revienta.
    const insertar = db.prepare(`
      INSERT OR IGNORE INTO asistencias (cliente_id, fecha_hora, fecha, metodo, membresia_id, ticket_usado, registrado_por)
      VALUES (?, ?, ?, 'manual', NULL, 0, ?)
    `);
    ASISTENCIAS_POR_DIA.forEach((cuantas, i) => {
      const fecha = format(addDays(new Date(), -(i + 1)), 'yyyy-MM-dd');
      for (let j = 0; j < Math.min(cuantas, ids.length); j++) {
        const r = insertar.run(ids[j], fecha + 'T12:00:00.000Z', fecha, usuarioId);
        creado.asistencias += r.changes;
      }
    });
  });

  todoDeUnaVez();
  return { ok: true, creado };
}

module.exports = { sembrar, PREFIJO_DOC, NOMBRES };
