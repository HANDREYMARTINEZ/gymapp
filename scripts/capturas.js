// Herramienta de revision visual, no es una prueba.
//
// Siembra una base temporal con datos de ejemplo, abre la app, la desbloquea,
// inicia sesion y captura cada pantalla en PNG. Sirve para mirar el diseno sin
// tener que hacer el recorrido a mano cada vez que se toca un color.
//
// Uso:  vite build   y luego   electron scripts/capturas.js
// Las imagenes quedan en la carpeta que se indique en CAPTURAS_DIR, o en el
// temporal del sistema.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const raiz = path.join(__dirname, '..');
const destino = process.env.CAPTURAS_DIR || path.join(os.tmpdir(), 'gymapp-capturas');
const testDir = path.join(os.tmpdir(), 'gymapp-capturas-datos-' + Date.now());

fs.mkdirSync(destino, { recursive: true });
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const PASSPHRASE = 'passphrase-de-prueba';
const USUARIO = 'admin';
const CLAVE = 'clave1234';

const registro = [];
const anotar = (t) => { registro.push(t); };

// Escribe en un campo controlado por React: asignar .value a secas no dispara
// su onChange, asi que hay que usar el setter nativo y lanzar el evento.
const GUION_ESCRIBIR = `
  window.__escribir = function (selector, valor, indice) {
    const campos = document.querySelectorAll(selector);
    const el = campos[indice || 0];
    if (!el) return false;
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  window.__clicPorTexto = function (texto) {
    const nodos = [...document.querySelectorAll('button, li')];
    const objetivo = nodos.find(n => n.textContent.trim().toLowerCase().includes(texto.toLowerCase()));
    if (!objetivo) return false;
    objetivo.click();
    return true;
  };
  true;
`;

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

async function sembrar() {
  const { conectar, getDb } = require('../electron/db/connection');
  const dekMod = require('../electron/crypto/dek');
  const argon2 = require('argon2');
  const { format, addDays } = require('date-fns');

  conectar();
  const db = getDb();
  const hoy = format(new Date(), 'yyyy-MM-dd');
  const ahora = new Date().toISOString();

  const set = (clave, valor) => db.prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run(clave, valor);

  const dek = dekMod.generarDEK();
  const salt = dekMod.generarSalt();
  set('kdf_salt', salt);
  set('dek_wrapped_user', dekMod.envolverDEK(dek, dekMod.derivarKEK(PASSPHRASE, salt)));
  set('setup_completo', '1');
  set('gym_nombre', 'Gimnasio Central');
  set('gym_direccion', 'Calle 10 #45-30');
  set('gym_telefono', '3001234567');

  db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
              VALUES ('Administrador', ?, ?, 'admin', 1, ?)`)
    .run(USUARIO, await argon2.hash(CLAVE), ahora);
  db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
              VALUES ('Laura Recepcion', 'laura', ?, 'asistente', 1, ?)`)
    .run(await argon2.hash(CLAVE), ahora);

  const planes = require('../electron/db/repos/planes');
  const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 120000, dias_duracion: 30, color: '#3b5bdb' });
  planes.crear({ nombre: 'Trimestral', tipo: 'periodo', precio: 320000, dias_duracion: 90, color: '#51cf66' });
  planes.crear({ nombre: 'Diez clases', tipo: 'ticketera', precio: 90000, num_tickets: 10, dias_vigencia: 60, color: '#ffd43b' });

  const clientes = require('../electron/db/repos/clientes');
  const c1 = clientes.crear({ documento: '1020304050', nombre: 'Carolina Ríos', telefono: '3115557788', email: 'caro@mail.com' });
  const c2 = clientes.crear({ documento: '1098765432', nombre: 'Andrés Gómez', telefono: '3129998877' });
  clientes.crear({ documento: '1122334455', nombre: 'Marcela Duque', telefono: '3004445566' });

  // Un cliente solo puede marcar una vez al dia (indice unico), asi que para
  // poblar la grafica de la semana hacen falta tantos clientes como el dia mas
  // concurrido.
  const NOMBRES = ['Julián Pérez', 'Sofía Ramírez', 'Camilo Ospina', 'Valeria Cano',
                   'Mateo Restrepo', 'Isabela Torres', 'Samuel Arango', 'Daniela Vélez',
                   'Tomás Jaramillo'];
  NOMBRES.forEach((nombre, i) => {
    clientes.crear({ documento: '90000000' + i, nombre, telefono: '31000000' + i });
  });

  const productos = require('../electron/db/repos/productos');
  const agua = productos.crear({ nombre: 'Agua 600ml', categoria: 'Bebidas', p_venta: 3000, p_costo: 1800, stock: 24, stock_min: 6, codigo_barras: '7702001234567' }).id;
  productos.crear({ nombre: 'Barra proteica', categoria: 'Snacks', p_venta: 6500, p_costo: 4000, stock: 3, stock_min: 8 });
  productos.crear({ nombre: 'Toalla', categoria: 'Accesorios', p_venta: 25000, p_costo: 14000, stock: 1, stock_min: 4 });
  productos.crear({ nombre: 'Bebida isotónica', categoria: 'Bebidas', p_venta: 5000, p_costo: 3200, stock: 18, stock_min: 6 });

  const caja = require('../electron/db/repos/caja');
  caja.abrir({ usuarioId: 1, baseInicial: 50000 });

  const membresias = require('../electron/db/repos/membresias');
  const m1 = membresias.vender({ clienteId: c1, planId: mensual, usuarioId: 1 });
  membresias.registrarPago({ membresiaId: m1, monto: 120000, metodo: 'Efectivo', usuarioId: 1 });
  db.prepare(`UPDATE membresias SET f_fin = ? WHERE id = ?`).run(format(addDays(new Date(), 3), 'yyyy-MM-dd'), m1);

  const m2 = membresias.vender({ clienteId: c2, planId: mensual, usuarioId: 1 });
  membresias.registrarPago({ membresiaId: m2, monto: 120000, metodo: 'Tarjeta', usuarioId: 1 });

  const ventas = require('../electron/db/repos/ventas');
  ventas.registrar({ items: [{ productoId: agua, cantidad: 2 }], metodoPago: 'Efectivo', usuarioId: 1 });
  ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Tarjeta', usuarioId: 1 });

  const asistencias = require('../electron/db/repos/asistencias');
  asistencias.registrar({ clienteId: c1, metodo: 'manual', registradoPor: 1 });
  asistencias.registrar({ clienteId: c2, metodo: 'manual', registradoPor: 1 });
  for (let i = 1; i <= 6; i++) {
    const f = format(addDays(new Date(), -i), 'yyyy-MM-dd');
    const cuantas = [7, 4, 9, 6, 11, 3][i - 1];
    for (let j = 0; j < cuantas; j++) {
      db.prepare(`INSERT INTO asistencias (cliente_id, fecha_hora, fecha, metodo, membresia_id, ticket_usado, registrado_por)
                  VALUES (?, ?, ?, 'manual', NULL, 0, 1)`).run(j + 1, f + 'T12:00:00.000Z', f);
    }
  }

  anotar('Datos de ejemplo sembrados.');
}

app.whenReady().then(async () => {
  let ventana = null;
  try {
    await sembrar();

    // Todo el IPC, igual que en main.js.
    for (const m of ['config', 'setup', 'auth', 'usuarios', 'clientes', 'planes', 'productos',
                     'caja', 'ventas', 'dashboard', 'membresias', 'pausas', 'asistencias',
                     'kiosco', 'desbloqueo', 'backup']) {
      require('../electron/ipc/' + m);
    }

    ventana = new BrowserWindow({
      width: 1400, height: 900, show: false,
      webPreferences: {
        preload: path.join(raiz, 'electron', 'preload.js'),
        nodeIntegration: false, contextIsolation: true, sandbox: true,
      },
    });

    await ventana.loadFile(path.join(raiz, 'dist', 'index.html'));
    await esperar(1200);
    await ventana.webContents.executeJavaScript(GUION_ESCRIBIR);

    const capturar = async (nombre) => {
      const imagen = await ventana.webContents.capturePage();
      const ruta = path.join(destino, nombre + '.png');
      fs.writeFileSync(ruta, imagen.toPNG());
      anotar('  capturada: ' + nombre + '.png');
    };

    const ir = async (etiqueta, archivo) => {
      const ok = await ventana.webContents.executeJavaScript(`window.__clicPorTexto(${JSON.stringify(etiqueta)})`);
      if (!ok) { anotar('  NO se pudo navegar a: ' + etiqueta); return; }
      await esperar(900);
      await capturar(archivo);
    };

    // Desbloqueo
    await capturar('01-desbloqueo');
    await ventana.webContents.executeJavaScript(`window.__escribir('input[type=password]', ${JSON.stringify(PASSPHRASE)})`);
    await esperar(200);
    await ventana.webContents.executeJavaScript(`window.__clicPorTexto('Desbloquear')`);
    await esperar(1200);

    // Login
    await capturar('02-login');
    await ventana.webContents.executeJavaScript(`window.__escribir('input:not([type=password])', ${JSON.stringify(USUARIO)})`);
    await ventana.webContents.executeJavaScript(`window.__escribir('input[type=password]', ${JSON.stringify(CLAVE)})`);
    await esperar(200);
    await ventana.webContents.executeJavaScript(`window.__clicPorTexto('Entrar')`);
    await esperar(1500);

    await capturar('03-kiosco');
    await ir('Clientes', '04-clientes');
    await ir('POS', '05-pos');
    await ir('Caja', '06-caja');
    await ir('Planes', '07-planes');
    await ir('Inventario', '08-inventario');
    await ir('Dashboards', '09-dashboards');
    await ir('Usuarios', '10-usuarios');
    await ir('Configuración', '11-configuracion');

    anotar('');
    anotar('Capturas en: ' + destino);
  } catch (e) {
    anotar('EXCEPCION -> ' + e.stack);
  }

  fs.writeFileSync(path.join(destino, 'registro.txt'), registro.join(String.fromCharCode(10)), 'utf-8');
  if (ventana) ventana.destroy();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(0);
});
