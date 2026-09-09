const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-sidecar-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const REGISTRO = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'GymApp', 'sidecar.log');
const testDir = path.join(os.tmpdir(), 'gymapp-test-sidecar-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// Habla con el sidecar como lo hace la app, pero devolviendo lo que conteste.
function preguntar(mensaje, msEspera = 2500) {
  return new Promise((resolve) => {
    let respuesta = null;
    const ws = new WebSocket('ws://127.0.0.1:8383');
    const reloj = setTimeout(() => { try { ws.close(); } catch (e) {} resolve(respuesta); }, msEspera);
    ws.onopen = () => ws.send(JSON.stringify(mensaje));
    ws.onmessage = (e) => {
      respuesta = e.data;
      clearTimeout(reloj);
      try { ws.close(); } catch (err) {}
      resolve(respuesta);
    };
    ws.onerror = () => { clearTimeout(reloj); resolve('SIN_CONEXION'); };
  });
}

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();
    const proceso = require('../electron/services/sidecarProceso');
    const setup = require('../electron/ipc/setup');

    // ------------------------------------------------ la clave publica del escrow
    const pem = setup.rutaClavePublica();
    check('la clave pública del escrow se encuentra', fs.existsSync(pem), pem);
    check('y es una clave pública de verdad',
          fs.readFileSync(pem, 'utf-8').includes('BEGIN PUBLIC KEY'));

    // ------------------------------------------------------------------ el token
    const t1 = proceso.token();
    check('genera un token la primera vez', typeof t1 === 'string' && t1.length >= 32,
          'largo=' + t1.length);
    check('y no es el de ejemplo del código', t1 !== 'CAMBIA-ESTE-TOKEN');
    check('lo guarda para no cambiarlo en cada arranque', proceso.token() === t1);
    check('queda en la base, no en el código',
          db.prepare(`SELECT valor FROM config WHERE clave = ?`).get(proceso.CLAVE_TOKEN).valor === t1);

    // Un sidecar abierto a mano desde Visual Studio se queda con el puerto y
    // contesta en su lugar. Se detecta antes de empezar, porque si no los
    // resultados salen al reves y no se entiende por que.
    const ocupado = await preguntar({ token: 'x', accion: 'cargarTemplates', templates: [] }, 1500);
    check('el puerto 8383 esta libre antes de empezar', ocupado === 'SIN_CONEXION',
          'ya contesta algo: ' + ocupado + ' (cierra el sidecar que tengas abierto)');

    // ------------------------------------------------------------- el ejecutable
    const exe = proceso.rutaExe();
    check('encuentra el ejecutable del sidecar', !!exe, exe || 'no está compilado');

    if (!exe) {
      log('  (sin sidecar compilado, se omite el resto)');
    } else {
      // ---------------------------------------- arranca, y sin lector no se cuelga
      check('todavía no está corriendo', proceso.estaVivo() === false);
      // Se vacia el registro para leer solo lo de esta corrida.
      try { fs.mkdirSync(path.dirname(REGISTRO), { recursive: true }); fs.writeFileSync(REGISTRO, ''); } catch (e) {}
      const encendido = proceso.asegurarEncendido();
      check('la app lo arranca sola', encendido.ok === true, 'motivo=' + encendido.motivo);
      await esperar(2500);
      check('y sigue vivo pasados unos segundos', proceso.estaVivo() === true);

      // Este es el punto: en este PC no hay lector conectado. Antes eso sacaba un
      // MessageBox que bloqueaba el Load y el servidor no llegaba a levantarse.
      const conTokenBueno = await preguntar({ token: t1, accion: 'cargarTemplates', templates: [] });
      check('levanta el servidor aunque no haya lector conectado',
            conTokenBueno !== 'SIN_CONEXION', 'respuesta=' + conTokenBueno);

      // --------------------------------------------- la prioridad de adquisicion
      //
      // Esto es lo que costo encontrar, y lo que se rompe en silencio si alguien
      // vuelve al constructor sin argumentos. Con prioridad Normal el lector solo
      // entrega las muestras a la ventana que tiene el foco, y el sidecar corre
      // oculto: OnReaderConnect llegaria igual, pero OnFingerTouch y OnComplete
      // no llegarian nunca. No falla, simplemente deja de leer huellas.
      const registro = fs.existsSync(REGISTRO) ? fs.readFileSync(REGISTRO, 'utf-8') : '';
      check('la captura se pide con prioridad Low, la de segundo plano',
            registro.includes('Prioridad de captura: Low'),
            (registro.match(/Prioridad de captura: \w+/) || ['no consta'])[0]);
      check('y la adquisición se crea sin error',
            registro.includes('StartCapture() no lanzo excepcion') &&
            !registro.includes('No se pudo iniciar el lector'),
            registro.includes('No se pudo iniciar el lector') ? 'fallo al crear la adquisición' : '');
      check('el lector se anuncia aunque la ventana esté oculta',
            registro.includes('Ventana oculta=True') && registro.includes('OnReaderConnect'));

      const conTokenMalo = await preguntar({ token: 'CAMBIA-ESTE-TOKEN', accion: 'cargarTemplates', templates: [] });
      check('rechaza el token de ejemplo',
            typeof conTokenMalo === 'string' && conTokenMalo.includes('token'),
            'respuesta=' + conTokenMalo);

      const otraVez = proceso.asegurarEncendido();
      check('pedirlo dos veces no abre un segundo proceso', otraVez.yaEstaba === true);

      proceso.apagar();
      await esperar(800);
      check('la app lo apaga al cerrarse', proceso.estaVivo() === false);
      check('y despues ya no contesta',
            (await preguntar({ token: t1, accion: 'cargarTemplates', templates: [] }, 1200)) === 'SIN_CONEXION');
    }

    db.close();
  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  try { require('../electron/services/sidecarProceso').apagar(); } catch (e) {}
  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallos === 0 ? 0 : 1);
});
