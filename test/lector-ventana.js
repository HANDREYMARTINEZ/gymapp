// El lector de codigos DENTRO de la app, con pulsaciones de verdad.
//
// test/lector.js prueba el detector con instantes inventados. Lo que no puede
// probar es lo que importa en el mostrador: que los digitos que el lector
// alcanza a teclear NO se quedan en el campo con foco (la cantidad del carrito,
// el PIN del kiosco, la contrasena), que las pantallas que no usan codigos lo
// ignoran, y que a una persona tecleando no se le traga ninguna tecla.
//
// webContents.sendInputEvent manda teclas como las del teclado fisico: el
// navegador las trata igual que al lector (escriben en el campo, disparan
// onChange). Mandadas seguidas llegan a pocos milisegundos, como el lector.
//
// Necesita el bundle compilado: se corre con `npm run test:produccion`, que hace
// vite build antes.

const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-lector-ventana-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

const raiz = path.join(__dirname, '..');
const testDir = path.join(os.tmpdir(), 'gymapp-test-lector-ventana-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const PASSPHRASE = 'passphrase-de-prueba';
const CLAVE = 'clave1234';

async function sembrar() {
  const { conectar, getDb } = require('../electron/db/connection');
  const dekMod = require('../electron/crypto/dek');
  const argon2 = require('argon2');
  conectar();
  const db = getDb();
  const set = (clave, valor) => db.prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run(clave, valor);
  const dek = dekMod.generarDEK();
  const salt = dekMod.generarSalt();
  set('kdf_salt', salt);
  set('dek_wrapped_user', dekMod.envolverDEK(dek, await dekMod.derivarKEK(PASSPHRASE, salt)));
  set('setup_completo', '1');
  set('gym_nombre', 'Gimnasio Prueba');
  dekMod.guardarDekEnMemoria(dek);
  db.prepare(`INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
              VALUES ('Admin', 'admin', ?, 'admin', 1, ?)`).run(await argon2.hash(CLAVE), new Date().toISOString());

  const productos = require('../electron/db/repos/productos');
  productos.crear({ nombre: 'Agua 600ml', p_venta: 3000, stock: 10, codigo_barras: '7702004003003' });
  productos.crear({ nombre: 'Barra de proteina', p_venta: 8000, stock: 1, codigo_barras: '7700304572069' });
  const viejo = productos.crear({ nombre: 'Producto viejo', p_venta: 1000, stock: 5, codigo_barras: '11112222' }).id;
  productos.desactivar(viejo);
  return db;
}

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra !== undefined ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };
  let ventana = null;

  try {
    if (!fs.existsSync(path.join(raiz, 'dist', 'index.html'))) throw new Error('falta dist/: corre vite build antes');
    const db = await sembrar();
    const dirIpc = path.join(raiz, 'electron', 'ipc');
    for (const f of fs.readdirSync(dirIpc)) if (f.endsWith('.js')) require(path.join(dirIpc, f));
    session.defaultSession.setPermissionRequestHandler((_wc, _p, conceder) => conceder(false));

    ventana = new BrowserWindow({
      width: 1300, height: 850, show: false,
      webPreferences: { preload: path.join(raiz, 'electron', 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    ventana.showInactive();
    await ventana.loadFile(path.join(raiz, 'dist', 'index.html'));
    await esperar(1200);

    const wc = ventana.webContents;
    const js = (codigo) => wc.executeJavaScript(codigo);
    const escribirReact = (selector, valor) => js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(valor)});
      el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const clic = async (texto) => {
      const ok = await js(`(() => {
        const busca = ${JSON.stringify(texto.toLowerCase())};
        const nodos = [...document.querySelectorAll('button, li')].filter(n => n.textContent.trim().toLowerCase().includes(busca));
        const obj = nodos.filter(n => !nodos.some(o => o !== n && n.contains(o)))[0];
        if (!obj) return false; obj.click(); return true; })()`);
      await esperar(700);
      return ok;
    };
    const enfocar = (selector) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return document.activeElement === el; })()`);
    const valor = (selector) => js(`(document.querySelector(${JSON.stringify(selector)}) || {}).value`);
    const textoPagina = () => js('document.body.innerText');
    const cuenta = () => js('JSON.parse(JSON.stringify(window.__lector || {}))');

    wc.focus();

    function pulsar(tecla) {
      const keyCode = tecla === 'Enter' ? 'Return' : tecla;
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      wc.sendInputEvent({ type: 'char', keyCode: tecla === 'Enter' ? '\r' : tecla });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
    }
    // El lector: todo seguido, sin esperar.
    async function escanear(codigo) {
      for (const c of codigo) pulsar(c);
      pulsar('Enter');
      await esperar(600);
    }
    // Una persona: 110 ms entre tecla y tecla.
    async function teclearComoPersona(texto) {
      for (const c of texto) { pulsar(c); await esperar(110); }
      await esperar(300);
    }

    // ------------------------------------------------------------- login
    await js(`(() => { const u = document.querySelector('input[placeholder="Usuario"]'); if (u) u.focus(); return !!u; })()`);
    await escribirReact('input[placeholder="Usuario"]', 'admin');

    // El Login no escucha codigos: un escaneo con el foco en la contrasena no
    // puede dejarle digitos dentro.
    await enfocar('input[placeholder="Contraseña"]');
    await escanear('7702004003003');
    check('en el Login, un escaneo no deja digitos en la contrasena',
          (await valor('input[placeholder="Contraseña"]')) === '', JSON.stringify(await valor('input[placeholder="Contraseña"]')));
    check('y se detecto como escaneo sin pantalla que lo quiera', (await cuenta()).sinOyente === 1, JSON.stringify(await cuenta()));

    await escribirReact('input[placeholder="Contraseña"]', CLAVE);
    await clic('Entrar');
    await esperar(1500);
    if (await js(`!!document.querySelector('input[placeholder="Passphrase de cifrado"]')`)) {
      await escribirReact('input[placeholder="Passphrase de cifrado"]', PASSPHRASE);
      await clic('Continuar');
      await esperar(1500);
    }
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true;`);
    await esperar(1500);

    // ------------------------------------------------------------ kiosco
    const ULT4 = 'input[placeholder="Últimos 4 del documento"]';
    const PIN = 'input[placeholder="PIN"]';
    check('tras entrar se esta en el Kiosco', await enfocar(ULT4));

    const pinFallidosAntes = db.prepare("SELECT COUNT(*) n FROM auditoria WHERE accion = 'pin_fallido'").get().n;
    await escanear('7702004003003');
    check('en el Kiosco, un escaneo no deja digitos en el documento',
          (await valor(ULT4)) === '', JSON.stringify(await valor(ULT4)));
    check('ni en el PIN, al que el kiosco salta solo tras 4 digitos',
          (await valor(PIN)) === '', JSON.stringify(await valor(PIN)));
    check('ni intenta marcar asistencia con esos digitos',
          db.prepare("SELECT COUNT(*) n FROM auditoria WHERE accion = 'pin_fallido'").get().n === pinFallidosAntes &&
          !(await textoPagina()).includes('PIN incorrecto'));

    // A una persona no se le traga nada.
    await enfocar(ULT4);
    await teclearComoPersona('1234');
    check('una persona tecleando 1234 en el kiosco lo ve escrito entero', (await valor(ULT4)) === '1234', JSON.stringify(await valor(ULT4)));
    await escribirReact(ULT4, '');
    await escribirReact(PIN, '');

    // ------------------------------------------------------------ vender
    await clic('Vender');
    await esperar(800);
    const BUSCADOR = 'input[placeholder^="Buscar o escanear"]';
    const lineasCarrito = () => js(`(() => {
      const h = [...document.querySelectorAll('h3')].find(x => x.textContent.includes('Venta actual'));
      if (!h) return null;
      return [...h.parentElement.querySelectorAll('tbody tr')]
        .filter(tr => tr.querySelector('input[type=number]'))
        .map(tr => ({ nombre: tr.querySelector('td').childNodes[0].textContent.trim(), cantidad: tr.querySelector('input[type=number]').value }));
    })()`);

    check('Vender tiene el buscador', await enfocar(BUSCADOR));
    await escanear('7702004003003');
    let carrito = await lineasCarrito();
    check('escanear con el foco en el buscador agrega el producto',
          carrito && carrito.length === 1 && carrito[0].nombre === 'Agua 600ml' && carrito[0].cantidad === '1', JSON.stringify(carrito));
    check('y el buscador queda limpio', (await valor(BUSCADOR)) === '', JSON.stringify(await valor(BUSCADOR)));
    check('avisa lo que agrego', (await textoPagina()).includes('+1  Agua 600ml') || (await textoPagina()).includes('+1 Agua 600ml'));

    // El caso que motivo todo esto: el foco en la cantidad de una linea.
    await enfocar('h3 ~ table input[type=number]');
    const focoEnCantidad = await js(`document.activeElement && document.activeElement.type === 'number'`);
    await escanear('7702004003003');
    carrito = await lineasCarrito();
    check('con el foco en la CANTIDAD, escanear suma 1 y no escribe el codigo en ella',
          focoEnCantidad && carrito && carrito.length === 1 && carrito[0].cantidad === '2', JSON.stringify({ focoEnCantidad, carrito }));

    await enfocar(BUSCADOR);
    await escanear('7700304572069');
    await escanear('7700304572069');
    carrito = await lineasCarrito();
    const barra = carrito.find(l => l.nombre === 'Barra de proteina');
    check('no deja escanear mas unidades de las que hay', barra && barra.cantidad === '1', JSON.stringify(carrito));
    check('y lo dice', (await textoPagina()).includes('sólo hay 1'));

    await escanear('9999999999999');
    check('un codigo no registrado se avisa, sin crear nada', (await textoPagina()).includes('no está registrado'));
    await escanear('11112222');
    check('un producto desactivado se dice como tal', (await textoPagina()).includes('está desactivado'));

    await enfocar(BUSCADOR);
    await teclearComoPersona('Agua');
    check('una persona escribiendo en el buscador lo ve escrito entero', (await valor(BUSCADOR)) === 'Agua', JSON.stringify(await valor(BUSCADOR)));
    await escribirReact(BUSCADOR, '');

    // --------------------------------------------------- entrada de mercancia
    await clic('Inventario');
    await esperar(800);
    await clic('Entrada de mercancía');
    await esperar(800);
    check('se abre la Entrada de mercancia', (await textoPagina()).includes('Nada cambia hasta que confirmes'));

    const lineasEntrada = () => js(`(() => [...document.querySelectorAll('tbody tr')]
      .filter(tr => tr.querySelector('input'))
      .map(tr => ({ nombre: tr.querySelector('td').childNodes[0].textContent.trim(), cantidad: tr.querySelector('input').value })))()`);

    await escanear('7702004003003');
    await escanear('7702004003003');
    await escanear('7702004003003');
    let entrada = await lineasEntrada();
    check('tres escaneos del mismo producto son una linea con 3',
          entrada.length === 1 && entrada[0].cantidad === '3', JSON.stringify(entrada));

    await js(`(() => { const el = document.querySelector('tbody input'); el.focus(); return true; })()`);
    await escanear('7700304572069');
    entrada = await lineasEntrada();
    const aguaEntrada = entrada.find(l => l.nombre === 'Agua 600ml');
    check('con el foco en una cantidad de la entrada, escanear otro producto no la ensucia',
          entrada.length === 2 && aguaEntrada && aguaEntrada.cantidad === '3', JSON.stringify(entrada));

    const stockAntes = db.prepare("SELECT stock FROM productos WHERE codigo_barras = '7702004003003'").get().stock;
    check('escanear en la entrada NO toca el stock hasta confirmar', stockAntes === 10, String(stockAntes));

    await escanear('5555555555555');
    check('en la entrada, un codigo desconocido ofrece crearlo', (await textoPagina()).includes('Crear producto con este código'));

    await clic('Revisar entrada');
    await clic('Sí, aplicar entrada');
    await esperar(800);
    const stockDespues = db.prepare("SELECT stock FROM productos WHERE codigo_barras = '7702004003003'").get().stock;
    check('al confirmar, la entrada suma de verdad', stockDespues === 13 && (await textoPagina()).includes('Entrada aplicada'), String(stockDespues));

    const c = await cuenta();
    // Login y Kiosco los ignoran a proposito (2); Vender e Inventario los usan todos.
    check('solo quedaron sin pantalla los escaneos del Login y del Kiosco', c.sinOyente === 2, JSON.stringify(c));
  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try { if (ventana) ventana.destroy(); } catch (e) {}
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallos === 0 ? 0 : 1);
});
