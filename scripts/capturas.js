// Recorrido visual de la app entera, no es una prueba de logica.
//
// Siembra una base temporal con datos de ejemplo, abre la app de verdad -- con
// su preload, su IPC y su base -- entra por el Login y captura cada pantalla en
// PNG. Sirve para mirar el diseno y para ver de un vistazo que ninguna pantalla
// revienta al abrirse, que es lo que las suites de test no miran.
//
// Uso:  npm run build:vite   y luego   electron scripts/capturas.js
// Las imagenes quedan en CAPTURAS_DIR, o en el temporal del sistema.
//
// Lo que se siembra esta pensado para que ninguna pantalla salga vacia: hay
// membresias en cada estado, un cliente sin cedula real, un producto fuera de
// caja, otro bajo minimo, uno con imagen, ventas de los dos tipos y asistencias
// de toda la semana.

const { app, BrowserWindow, nativeImage, session } = require('electron');
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
const anotar = (t) => { registro.push(t); console.log(t); };

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
  // Se clica el elemento MAS PROFUNDO que contiene el texto. Muchas filas de la
  // app son un <div> con onClick dentro de otro <div>: clicar el de fuera no
  // dispara nada, porque el manejador esta en un hijo y los eventos suben, no
  // bajan. Desde el de dentro, React lo ve subir y funciona.
  window.__clicPorTexto = function (texto, etiquetas) {
    const busca = texto.toLowerCase();
    const nodos = [...document.querySelectorAll(etiquetas || 'button, li')]
      .filter(n => n.textContent.trim().toLowerCase().includes(busca));
    const objetivo = nodos.filter(n => !nodos.some(otro => otro !== n && n.contains(otro)))[0];
    if (!objetivo) return false;
    objetivo.click();
    return true;
  };
  // Clic dentro de una tarjeta concreta, buscandola por su titulo. Hace falta
  // porque un texto como "#1" aparece en varias listas de la misma pantalla --
  // la venta #1 y el movimiento "Pago de membresia #1" -- y sin acotar se clica
  // la primera, que no es la que se queria.
  window.__clicEnTarjeta = function (titulo, texto, etiquetas) {
    const h3 = [...document.querySelectorAll('h3')]
      .find(h => h.textContent.toLowerCase().includes(titulo.toLowerCase()));
    if (!h3 || !h3.parentElement || !h3.parentElement.parentElement) return false;
    const tarjeta = h3.parentElement.parentElement;
    const busca = texto.toLowerCase();
    const nodos = [...tarjeta.querySelectorAll(etiquetas || 'button, li, tr')]
      .filter(n => n.textContent.trim().toLowerCase().includes(busca));
    const objetivo = nodos.filter(n => !nodos.some(otro => otro !== n && n.contains(otro)))[0];
    if (!objetivo) return false;
    objetivo.scrollIntoView({ block: 'center' });
    objetivo.click();
    return true;
  };
  // La app no scrollea la ventana sino su <main>: el menu lateral se queda fijo.
  window.__scroll = function (px) {
    const m = document.querySelector('main');
    if (m) { m.scrollTop = px; return true; }
    window.scrollTo(0, px);
    return false;
  };
  // Las pantallas atrapan sus errores y pintan mensajes; esto recoge los que se
  // escaparon a la consola para poder cantarlos al final.
  window.__errores = [];
  window.addEventListener('error', (e) => window.__errores.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errores.push('promesa: ' + String(e.reason)));
  true;
`;

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// Una imagen cualquiera, para que el producto con foto no dependa de tener un
// archivo al lado del guion.
function imagenDePrueba(lado) {
  const pixeles = Buffer.alloc(lado * lado * 4);
  for (let i = 0; i < lado * lado; i++) {
    pixeles[i * 4 + 0] = 40;                 // B
    pixeles[i * 4 + 1] = (i * 11) % 256;     // G
    pixeles[i * 4 + 2] = 220;                // R
    pixeles[i * 4 + 3] = 255;                // A
  }
  return nativeImage.createFromBitmap(pixeles, { width: lado, height: lado }).toJPEG(90);
}

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
  set('dek_wrapped_user', dekMod.envolverDEK(dek, await dekMod.derivarKEK(PASSPHRASE, salt)));
  set('setup_completo', '1');
  set('gym_nombre', 'Gimnasio Central');
  set('gym_direccion', 'Calle 10 #45-30');
  set('gym_telefono', '3001234567');

  // El acceso de desarrollador y las imagenes necesitan la DEK en memoria; sin
  // esto la foto del producto no se puede cifrar y la captura saldria vacia.
  dekMod.guardarDekEnMemoria(dek);

  db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
              VALUES ('Administrador', ?, ?, 'admin', 1, ?)`)
    .run(USUARIO, await argon2.hash(CLAVE), ahora);
  db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
              VALUES ('Laura Recepcion', 'laura', ?, 'asistente', 1, ?)`)
    .run(await argon2.hash(CLAVE), ahora);

  const planes = require('../electron/db/repos/planes');
  const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 120000, dias_duracion: 30, color: '#ffe500' });
  planes.crear({ nombre: 'Trimestral', tipo: 'periodo', precio: 320000, dias_duracion: 90, color: '#51cf66' });
  const tiquetera = planes.crear({ nombre: 'Diez clases', tipo: 'ticketera', precio: 90000, num_tickets: 10, dias_vigencia: 60, color: '#ffa94d' });

  const clientes = require('../electron/db/repos/clientes');
  const c1 = clientes.crear({ documento: '1020304050', nombre: 'Carolina Ríos', telefono: '3115557788', email: 'caro@mail.com' });
  const c2 = clientes.crear({ documento: '1098765432', nombre: 'Andrés Gómez', telefono: '3129998877' });
  // Con correo y con la membresia vencida: es la que hace que la seccion de
  // recordatorios tenga a alguien a quien escribirle en las capturas.
  const c3 = clientes.crear({ documento: '1122334455', nombre: 'Marcela Duque', telefono: '3004445566', email: 'marce@mail.com' });
  // Uno sin cedula real, para ver el aviso de documento provisional.
  const c4 = clientes.crear({ nombre: 'Jorge Sin Cédula', telefono: '3011112233' });

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
  const barra = productos.crear({ nombre: 'Barra proteica', categoria: 'Snacks', p_venta: 6500, p_costo: 4000, stock: 3, stock_min: 8 }).id;
  productos.crear({ nombre: 'Toalla', categoria: 'Accesorios', p_venta: 25000, p_costo: 14000, stock: 1, stock_min: 4 });
  productos.crear({ nombre: 'Bebida isotónica', categoria: 'Bebidas', p_venta: 5000, p_costo: 3200, stock: 18, stock_min: 6 });
  // El que no es dinero del gimnasio: alimenta el bloque de fuera de caja.
  const crema = productos.crear({ nombre: 'Crema de un tercero', categoria: 'Terceros', p_venta: 20000, p_costo: 0, stock: 9, stock_min: 0, fuera_de_caja: true }).id;

  // La foto de un producto, guardada por el mismo camino que usa la pantalla.
  // Es lo que deja ver si la imagen aparece en Vender, en Inventario y dentro
  // del formulario de editar, que es justo donde no salia.
  const imagenes = require('../electron/services/imagenes');
  const r = imagenes.guardar({ entidad: 'producto', entidadId: agua, base64: imagenDePrueba(240).toString('base64') });
  anotar(r.ok ? 'Imagen del producto sembrada.' : 'NO se pudo sembrar la imagen: ' + r.motivo);

  const caja = require('../electron/db/repos/caja');
  caja.abrir({ usuarioId: 1, baseInicial: 50000 });

  const membresias = require('../electron/db/repos/membresias');
  // Activa y por vencer.
  const m1 = membresias.vender({ clienteId: c1, planId: mensual, usuarioId: 1 });
  membresias.registrarPago({ membresiaId: m1, monto: 120000, metodo: 'Efectivo', usuarioId: 1 });
  db.prepare(`UPDATE membresias SET f_fin = ? WHERE id = ?`).run(format(addDays(new Date(), 3), 'yyyy-MM-dd'), m1);

  // Con saldo pendiente: se vendio y solo se abono una parte.
  const m2 = membresias.vender({ clienteId: c2, planId: mensual, usuarioId: 1 });
  membresias.registrarPago({ membresiaId: m2, monto: 60000, metodo: 'Tarjeta', usuarioId: 1 });

  // Vencida hace una semana.
  const m3 = membresias.vender({ clienteId: c3, planId: mensual, usuarioId: 1 });
  membresias.registrarPago({ membresiaId: m3, monto: 120000, metodo: 'Nequi', usuarioId: 1 });
  db.prepare(`UPDATE membresias SET f_inicio = ?, f_fin = ? WHERE id = ?`)
    .run(format(addDays(new Date(), -37), 'yyyy-MM-dd'), format(addDays(new Date(), -7), 'yyyy-MM-dd'), m3);

  // Una tiquetera casi agotada, para el estado 'por vencer' de ese tipo.
  const m4 = membresias.vender({ clienteId: c4, planId: tiquetera, usuarioId: 1 });
  membresias.registrarPago({ membresiaId: m4, monto: 90000, metodo: 'Efectivo', usuarioId: 1 });
  db.prepare(`UPDATE membresias SET tickets_usados = 9 WHERE id = ?`).run(m4);

  const ventas = require('../electron/db/repos/ventas');
  ventas.registrar({ items: [{ productoId: agua, cantidad: 2 }], metodoPago: 'Efectivo', usuarioId: 1 });
  ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }, { productoId: barra, cantidad: 2 }], metodoPago: 'Tarjeta', usuarioId: 1 });
  // Un ticket mezclado: parte del gimnasio y parte no.
  ventas.registrar({ items: [{ productoId: barra, cantidad: 1 }, { productoId: crema, cantidad: 1 }], metodoPago: 'Efectivo', usuarioId: 1 });

  // Fiados: la membresia con saldo queda fiada hasta dentro de 4 dias, y el mismo
  // cliente se lleva un agua fiada. Asi "Deben dinero" y la ficha ensenan la
  // cuenta con las dos cosas juntas.
  membresias.fiar({ membresiaId: m2, fiadoHasta: format(addDays(new Date(), 4), 'yyyy-MM-dd'), usuarioId: 1 });
  ventas.registrar({ items: [{ productoId: agua, cantidad: 1 }], metodoPago: 'Fiado', usuarioId: 1, clienteId: c2 });

  // Y una venta de fuera de caja de ayer, para que el rango de fechas tenga algo
  // que ensenar mas alla de hoy.
  const ayer = new Date(Date.now() - 24 * 3600 * 1000);
  const ventaVieja = db.prepare(
    `INSERT INTO ventas (fecha, total, metodo_pago, usuario_id, cliente_id, anulada)
     VALUES (?, 20000, 'Nequi', 1, NULL, 0)`).run(ayer.toISOString()).lastInsertRowid;
  db.prepare(
    `INSERT INTO venta_items (venta_id, producto_id, producto_nombre, cantidad, p_unitario, p_costo_unit, fuera_de_caja)
     VALUES (?, ?, 'Crema de un tercero', 1, 20000, 0, 1)`).run(ventaVieja, crema);

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

  // Un recordatorio ya enviado: asi la seccion ensena el caso de "ya avisados" y
  // la casilla para volver a escribirles.
  db.prepare(`INSERT INTO recordatorios_enviados (cliente_id, membresia_id, tipo, email, fecha, ok, error)
              VALUES (?, ?, 'vencida', 'marce@mail.com', ?, 1, NULL)`)
    .run(c3, m3, new Date(Date.now() - 2 * 86400000).toISOString());

  anotar('Datos de ejemplo sembrados (hoy = ' + hoy + ').');
}

app.whenReady().then(async () => {
  let ventana = null;
  try {
    await sembrar();

    // Todo el IPC. Se lee la carpeta en vez de llevar la lista a mano: cuando
    // era una lista, cada modulo nuevo se olvidaba aqui, y entonces la pantalla
    // que lo usa se captura a medias -- sale la foto, parece que todo va bien, y
    // el fallo esta en la consola donde nadie mira. Paso con 'portapapeles' y
    // volvio a pasar con 'puerta'.
    const dirIpc = path.join(__dirname, '..', 'electron', 'ipc');
    for (const archivo of fs.readdirSync(dirIpc)) {
      if (archivo.endsWith('.js')) require(path.join(dirIpc, archivo));
    }

    // El mismo permiso que da main.js: sin esto la camara del formulario de
    // cliente se comportaria distinto aqui que en la app de verdad.
    session.defaultSession.setPermissionRequestHandler((_wc, permiso, conceder) => {
      conceder(permiso === 'media');
    });

    ventana = new BrowserWindow({
      width: 1400, height: 900, show: false,
      // Se muestra sin robar el foco un poco mas abajo: una ventana oculta del
      // todo no repinta, y las capturas salian de la pantalla anterior.
      backgroundColor: '#0c0b08',
      webPreferences: {
        preload: path.join(raiz, 'electron', 'preload.js'),
        nodeIntegration: false, contextIsolation: true, sandbox: true,
      },
    });

    ventana.showInactive();
    await ventana.loadFile(path.join(raiz, 'dist', 'index.html'));
    await esperar(1200);
    await ventana.webContents.executeJavaScript(GUION_ESCRIBIR);

    const js = (codigo) => ventana.webContents.executeJavaScript(codigo);

    // El titulo de la pantalla en la que estamos de verdad. Sin esto, un clic que
    // no navega deja una captura de la pantalla anterior con nombre de otra, y
    // eso engana mas que no tener captura.
    const tituloActual = () => js(`(document.querySelector('main h1') || document.querySelector('h1') || {}).textContent || '(sin titulo)'`);

    const capturar = async (nombre) => {
      const titulo = (await tituloActual()).trim();
      const imagen = await ventana.webContents.capturePage();
      fs.writeFileSync(path.join(destino, nombre + '.png'), imagen.toPNG());
      anotar('  capturada: ' + nombre + '.png   [' + titulo + ']');
    };

    const clic = async (texto, etiquetas) => {
      const ok = await js(`window.__clicPorTexto(${JSON.stringify(texto)}, ${JSON.stringify(etiquetas || null)})`);
      if (!ok) anotar('  NO se encontro para clicar: ' + texto);
      await esperar(700);
      return ok;
    };

    // Se espera a que el titulo cambie antes de capturar. La ventana esta oculta
    // y Chromium no repinta a ritmo constante: capturar a ciegas devolvia a
    // veces la pantalla anterior con el nombre de archivo de la nueva, que es
    // peor que no tener la captura.
    const ir = async (etiqueta, archivo) => {
      const antes = (await tituloActual()).trim();
      const ok = await clic(etiqueta);
      if (!ok) return false;
      for (let i = 0; i < 15; i++) {
        if ((await tituloActual()).trim() !== antes) break;
        await esperar(200);
      }
      await esperar(400);
      await capturar(archivo);
      return true;
    };

    // ---- Login -----------------------------------------------------------
    // Ya no hay pantalla de Desbloquear: la puerta de entrada es el Login.
    await capturar('01-login');
    await js(`window.__escribir('input:not([type=password])', ${JSON.stringify(USUARIO)})`);
    await js(`window.__escribir('input[type=password]', ${JSON.stringify(CLAVE)})`);
    await esperar(200);
    await clic('Entrar');

    // La primera vez que un usuario entra despues del cambio a "solo contrasena"
    // se le pide la passphrase una vez, para engancharle su copia de la DEK.
    // Una base recien sembrada siempre pasa por aqui.
    const pideEnganche = await js(`!!document.querySelector('input[placeholder="Passphrase de cifrado"]')`);
    if (pideEnganche) {
      await capturar('01b-enganche-passphrase');
      await js(`window.__escribir('input[type=password]', ${JSON.stringify(PASSPHRASE)})`);
      await esperar(200);
      await clic('Continuar');
    }

    // La cortina de entrada dura unos segundos y se salta con un clic o una
    // tecla. Sin esto, las tres capturas siguientes serian el video.
    await esperar(600);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true;`);
    await esperar(1200);

    // ---- Dia a dia -------------------------------------------------------
    await capturar('02-kiosco');

    await ir('Clientes', '03-clientes');
    // Cobrar la cuenta de quien debe, desde la lista.
    if (await js(`window.__clicEnTarjeta('Deben dinero', 'Cobrar', 'button')`)) {
      await esperar(700);
      await capturar('03b-clientes-cobrar');
      await clic('Cancelar');
    } else anotar('  NO se encontro el boton Cobrar en "Deben dinero"');
    // La ficha de quien debe: la cuenta arriba y la membresia fiada.
    if (await clic('Andrés Gómez', 'b')) {
      await esperar(700);
      await capturar('04d-ficha-debe');
      if (await clic('Registrar pago / fiar')) {
        await js(`(function () { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'Fiado')); if (!s) return false; return window.__escribir('select', 'Fiado', [...document.querySelectorAll('select')].indexOf(s)); })()`);
        await esperar(500);
        await capturar('04e-ficha-fiar');
      }
      await clic('Volver a la lista');
    }
    // La ficha se abre desde la fila del cliente, que no es un boton.
    if (await clic('Carolina', 'div, tr, li, button')) await capturar('04-cliente-ficha');
    // "Volver a la lista" y no "Volver": en la ficha hay dos botones de volver y
    // el primero lleva al Kiosco, que dejaba el resto del recorrido fuera de
    // Clientes sin decir nada.
    await clic('Volver a la lista');

    // Nuevo cliente: el aviso de la cedula provisional y la camara.
    if (await clic('+ Nuevo cliente')) {
      await esperar(600);
      await capturar('04b-cliente-nuevo');
      if (await clic('Tomar foto')) {
        await esperar(2500);
        await capturar('04c-camara');
        await clic('Cancelar');
      }
      await clic('Cancelar');
    }

    await ir('Vender', '05-vender');
    if (await clic('Agua 600ml', 'button, li, div[role=button]')) {
      await capturar('06-vender-carrito');
      // Fiar el ticket: elegir 'Fiado', buscar al cliente y elegirlo.
      const conFiado = await js(`(function () { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'Fiado')); if (!s) return false; return window.__escribir('select', 'Fiado', [...document.querySelectorAll('select')].indexOf(s)); })()`);
      if (conFiado) {
        await esperar(400);
        await js(`window.__escribir('input[placeholder^="¿A quién"]', 'Andr')`);
        await esperar(900);
        await clic('Andrés Gómez', 'button');
        await esperar(700);
        await capturar('06b-vender-fiado');
      } else anotar('  NO aparece la opcion Fiado en Vender');
    }

    // El kiosco en la segunda pantalla, abierto a media venta: es justo para lo
    // que existe. Se abre con el boton del menu y se captura la otra ventana.
    if (await clic('2.ª pantalla')) {
      await esperar(2500);
      const kiosco = BrowserWindow.getAllWindows().find(v => v !== ventana && !v.isDestroyed());
      if (kiosco) {
        const { screen } = require('electron');
        const suya = screen.getDisplayMatching(kiosco.getBounds());
        const principal = screen.getDisplayMatching(ventana.getBounds());
        anotar('  segunda pantalla: ' + (kiosco.isFullScreen() ? 'pantalla completa' : 'en ventana')
               + (suya.id !== principal.id ? ', en el otro monitor' : ', en el MISMO monitor')
               + ' (' + screen.getAllDisplays().length + ' monitores)');
        const imagen = await kiosco.webContents.capturePage();
        fs.writeFileSync(path.join(destino, '05c-kiosco-segunda-pantalla.png'), imagen.toPNG());
        anotar('  capturada: 05c-kiosco-segunda-pantalla.png');
        const boton = await js(`([...document.querySelectorAll('button')].find(b => b.textContent.includes('2.ª pantalla')) || {}).textContent || ''`);
        if (!boton.includes('Quitar')) anotar('  el boton NO cambio a "Quitar" con la pantalla abierta: ' + boton);
        await capturar('05d-vender-con-segunda-pantalla');
        await clic('2.ª pantalla');
        await esperar(500);
        if (!kiosco.isDestroyed()) anotar('  la segunda pantalla NO se cerro con el boton');
      } else anotar('  NO se abrio la ventana de la segunda pantalla');
    } else anotar('  NO aparece el boton de la segunda pantalla');

    await ir('Caja', '07-caja');
    // Una venta desplegada: lo que llevaba y el boton de anular.
    const abrioVenta = await js(`window.__clicEnTarjeta('Ventas de productos', '#1')`);
    if (!abrioVenta) anotar('  NO se pudo desplegar la venta #1');
    else {
      await esperar(700);
      await capturar('07b-venta-detalle');
      if (await clic('Anular venta')) {
        await esperar(300);
        await capturar('07c-venta-anular');
        await clic('Cancelar');
      }
    }
    await js('window.__scroll(2000)');
    await esperar(400);
    await capturar('08-caja-fuera-de-caja');
    if (await clic('7 días')) await capturar('09-caja-fuera-rango');

    // ---- Administrar -----------------------------------------------------
    await ir('Planes', '10-planes');
    await ir('Inventario', '11-inventario');
    // Editar un producto CON imagen: es donde la foto no aparecia.
    if (await clic('Editar', 'button')) await capturar('12-inventario-editar');
    await clic('Cancelar');

    // Entrada y salida de mercancia, con un producto ya en la lista: vacia no se
    // ve nada de lo que importa. Se agrega por nombre, que es el camino sin lector.
    if (await clic('Entrada de mercancía', 'button')) {
      await js(`window.__escribir('input[placeholder^="Agregar sin código"]', 'a')`);
      await esperar(400);
      await js(`(() => { const d = [...document.querySelectorAll('div')].find(x => x.textContent.includes('— hay') && x.children.length <= 1); if (d) d.click(); return !!d; })()`);
      await esperar(500);
      await capturar('12b-inventario-entrada');
      await clic('Cancelar');
      await clic('Sí, descartar');
    }
    if (await clic('Salida de mercancía', 'button')) {
      await capturar('12c-inventario-salida');
      await clic('Cancelar');
    }

    await ir('Dashboards', '13-dashboards');
    await js('window.__scroll(1400)');
    await esperar(400);
    await capturar('14-dashboards-vendido');

    // ---- Sistema ---------------------------------------------------------
    await ir('Usuarios', '15-usuarios');
    await ir('Configuración', '16-configuracion');

    // Configuracion es larguisima y el primer pantallazo solo alcanza a los
    // datos del gimnasio. La seccion de la puerta queda muy por debajo, asi que
    // se baja hasta ella: es la unica forma de mirar como quedo.
    await js(`(() => {
      const h = [...document.querySelectorAll('main h2')].find(x => x.textContent.indexOf('Puerta') === 0);
      if (!h) return false;
      h.scrollIntoView({ block: 'start' });
      return true;
    })()`);
    await esperar(500);
    await capturar('16b-configuracion-puerta');

    // En que monitor sale el kiosco. Con monitores de verdad se comprueba de
    // punta a punta: elegir uno, abrir el kiosco y que salga justo en ese.
    await js(`(() => {
      const h = [...document.querySelectorAll('main h2')].find(x => x.textContent.indexOf('Pantalla del kiosco') === 0);
      if (h) h.scrollIntoView({ block: 'start' });
      return !!h;
    })()`) || anotar('  NO aparece la seccion Pantalla del kiosco');
    await esperar(500);
    await capturar('16c-configuracion-pantalla-kiosco');
    {
      const { screen } = require('electron');
      const lista = await js(`window.api.pantallaKiosco.pantallas()`);
      anotar('  pantallas: ' + lista.pantallas.map(p => p.numero + '=' + p.modelo + (p.recepcion ? '(recepcion)' : '')).join(', '));
      if (lista.pantallas.length >= 2) {
        const antes = BrowserWindow.getAllWindows().length;
        await js(`window.api.pantallaKiosco.identificar()`);
        await esperar(1200);
        const durante = BrowserWindow.getAllWindows().length - antes;
        await esperar(4000);
        const despues = BrowserWindow.getAllWindows().length - antes;
        anotar('  identificar: ' + durante + ' numeros en pantalla, ' + despues + ' a los 5 s');

        const otra = lista.pantallas.find(p => !p.recepcion);
        const r = await js(`window.api.pantallaKiosco.elegir(${JSON.stringify(String(otra.id))})`);
        if (!r.ok || r.elegidaId !== otra.id) anotar('  NO se pudo elegir la pantalla ' + otra.numero);
        const recep = lista.pantallas.find(p => p.recepcion);
        const mal = await js(`window.api.pantallaKiosco.elegir(${JSON.stringify(String(recep.id))})`);
        if (mal.ok) anotar('  se dejo elegir la pantalla de recepcion');
        await esperar(400);
        await capturar('16c2-configuracion-pantalla-elegida');

        await js(`window.api.pantallaKiosco.alternar()`);
        await esperar(2000);
        const kiosco = BrowserWindow.getAllWindows().find(v => v !== ventana && !v.isDestroyed());
        const donde = kiosco ? screen.getDisplayMatching(kiosco.getBounds()).id : null;
        anotar('  kiosco abierto en la elegida: ' + (donde === otra.id ? 'si' : 'NO (' + donde + ')')
               + (kiosco && kiosco.isFullScreen() ? ', pantalla completa' : ''));
        await js(`window.api.pantallaKiosco.cerrar()`);
        await js(`window.api.pantallaKiosco.elegir(null)`);
        await esperar(500);
      }
    }

    // Marcar la casilla SIN guardar tiene que sacar el aviso amarillo. Es la
    // trampa en la que se cayo la primera prueba de verdad: casilla marcada,
    // Guardar sin pulsar, y el kiosco sin abrir nada.
    await js(`(() => {
      const c = [...document.querySelectorAll('main input[type=checkbox]')]
        .find(x => (x.parentElement.textContent || '').indexOf('Abrir la puerta') >= 0);
      if (!c) return false;
      c.click();
      return true;
    })()`);
    await esperar(400);
    await capturar('16c-configuracion-puerta-sin-guardar');

    // Recordatorios, con alguien ya avisado: ahi sale la casilla para volver a
    // escribirle (15-sep-2026). Se marca para ver como queda el boton de enviar.
    await js(`(() => {
      const h = [...document.querySelectorAll('main h2')].find(x => x.textContent.indexOf('Recordatorios') === 0);
      if (!h) return false;
      h.scrollIntoView({ block: 'start' });
      return true;
    })()`);
    await esperar(500);
    await capturar('16d-configuracion-recordatorios');
    const marcoRepetir = await js(`(() => {
      const c = [...document.querySelectorAll('main input[type=checkbox]')]
        .find(x => (x.parentElement.textContent || '').indexOf('Volver a escribirle') >= 0);
      if (!c) return false;
      c.click();
      return true;
    })()`);
    if (!marcoRepetir) anotar('  NO se encontro la casilla de volver a escribirles');
    else {
      // La caja de "Ahora mismo" queda mas abajo que el encabezado de la seccion.
      await js(`(() => {
        const h = [...document.querySelectorAll('main h4')].find(x => x.textContent.indexOf('Ahora mismo') === 0);
        if (!h) return false;
        h.scrollIntoView({ block: 'center' });
        return true;
      })()`);
      await esperar(400);
      await capturar('16e-recordatorios-repetir');
    }

    // ---- Panel de desarrollador ------------------------------------------
    // Se sale y se vuelve a entrar con Ctrl+Alt+D, que es el unico camino.
    await clic('Cerrar sesión');
    await esperar(800);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', code: 'KeyD', ctrlKey: true, altKey: true, bubbles: true })); true;`);
    await esperar(400);
    await capturar('17-login-desarrollador');
    // Indice 1: el campo 0 es la contrasena normal, el 1 es el de la passphrase
    // del recuadro de desarrollador que acaba de abrirse.
    await js(`window.__escribir('input[type=password]', ${JSON.stringify(PASSPHRASE)}, 1)`);
    await esperar(200);
    await clic('Entrar como desarrollador');
    await esperar(600);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true;`);
    await esperar(1400);
    await ir('Herramientas', '18-desarrollador');

    // La seccion de planes queda debajo de "Vaciar datos": se baja hasta ella.
    await js(`(() => {
      const h = [...document.querySelectorAll('main h2')].find(x => x.textContent.trim() === 'Planes');
      if (!h) return false;
      h.scrollIntoView({ block: 'start' });
      return true;
    })()`);
    await esperar(500);
    await capturar('18b-desarrollador-planes');

    // La huella del desarrollador, para entrar con el dedo desde Ctrl+Alt+D.
    await js(`(() => {
      const h = [...document.querySelectorAll('main h2')].find(x => x.textContent.trim() === 'Mi huella de desarrollador');
      if (!h) return false;
      h.scrollIntoView({ block: 'start' });
      return true;
    })()`);
    await capturar('18c-desarrollador-huella');

    const errores = await js('window.__errores');
    if (errores && errores.length) {
      anotar('');
      anotar('ERRORES EN LA PANTALLA:');
      errores.forEach(e => anotar('  ' + e));
    } else {
      anotar('');
      anotar('Ninguna pantalla lanzo errores al abrirse.');
    }

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
