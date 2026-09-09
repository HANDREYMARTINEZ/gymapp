// Diagnóstico del lector de huella, desde la terminal.
//
// Arranca el sidecar igual que lo arranca la app, se conecta, lo pone a
// verificar, y va imprimiendo todo lo que llega mientras tocas el lector. La
// idea es que "no funciona" deje de ser una caja negra: aquí se ve si el lector
// se conecta, si detecta el dedo, si la muestra sale de mala calidad, o si no
// llega absolutamente nada.
//
// Uso:
//     npm run huella             (ventana del sidecar oculta, como en la app)
//     npm run huella:visible     (ventana a la vista, como el ejemplo del SDK)
//
// Ctrl+C para salir.

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VISIBLE = process.argv.includes('--visible') || process.env.GYMAPP_SIDECAR_VISIBLE === '1';
const REGISTRO = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'GymApp', 'sidecar.log');

// Si la terminal se cierra, o la salida se corta, la tubería de stdout se rompe y
// cualquier escritura posterior lanza EPIPE. Como aquí se escribe desde un
// temporizador, esa excepción salta fuera de todo try y Electron la enseña como
// "A JavaScript error occurred in the main process". No es un fallo de la app:
// es esta herramienta escribiendo a un sitio que ya no existe.
process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); });
process.on('uncaughtException', (e) => {
  if (e && e.code === 'EPIPE') process.exit(0);
  console.error('Error inesperado: ' + (e && e.message));
  process.exit(1);
});

function escribir(texto) {
  try { process.stdout.write(texto); } catch (e) { /* consola cerrada */ }
}

const hora = () => new Date().toLocaleTimeString('es-CO');
const decir = (t) => escribir('[' + hora() + '] ' + t + os.EOL);
const enBlanco = () => escribir(os.EOL);

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const conn = require('../electron/db/connection');
  conn.conectar();
  const proceso = require('../electron/services/sidecarProceso');

  enBlanco();
  decir('Modo ventana: ' + (VISIBLE ? 'VISIBLE' : 'oculta'));
  decir('Registro del sidecar: ' + REGISTRO);

  const exe = proceso.rutaExe();
  if (!exe) {
    decir('NO se encontró SidecarHuella.exe. Compílalo antes:');
    decir('  cd sidecar-huella');
    decir('  dotnet msbuild "EnrollmentSample CS.csproj" -t:Rebuild -p:Configuration=Release');
    app.exit(1);
    return;
  }
  decir('Ejecutable: ' + exe);

  // Se vacía el registro para que lo que salga sea de esta sesión y no de antes.
  try {
    fs.mkdirSync(path.dirname(REGISTRO), { recursive: true });
    fs.writeFileSync(REGISTRO, '');
  } catch (e) { /* si no se puede, se lee lo que haya */ }

  if (VISIBLE) process.env.GYMAPP_SIDECAR_VISIBLE = '1';
  const encendido = proceso.asegurarEncendido();
  if (!encendido.ok) {
    decir('No se pudo arrancar el sidecar: ' + encendido.motivo);
    app.exit(1);
    return;
  }
  decir('Sidecar arrancado. Esperando a que levante el servidor...');
  await new Promise(r => setTimeout(r, 2500));

  // Se sigue el registro del sidecar en vivo: ahí es donde escribe los eventos
  // que le entrega el lector.
  let leido = 0;
  setInterval(() => {
    try {
      const texto = fs.readFileSync(REGISTRO, 'utf-8');
      if (texto.length > leido) {
        escribir(texto.slice(leido));
        leido = texto.length;
      }
    } catch (e) { /* todavía no existe */ }
  }, 400);

  const ws = new WebSocket('ws://127.0.0.1:8383');

  ws.onopen = () => {
    decir('Conectado al sidecar. Poniéndolo a verificar...');
    ws.send(JSON.stringify({ token: proceso.token(), accion: 'cargarTemplates', templates: [] }));
    enBlanco();
    decir('>>> PON EL DEDO EN EL LECTOR, varias veces. <<<');
    decir('    Lo que salga a continuación viene del lector.');
    enBlanco();
  };
  ws.onmessage = (e) => decir('sidecar dice: ' + e.data);
  ws.onerror = () => decir('No se pudo conectar al sidecar en el puerto 8383.');
  ws.onclose = () => decir('El sidecar cerró la conexión.');

  const salir = () => {
    enBlanco();
    decir('Cerrando el sidecar...');
    proceso.apagar();
    app.exit(0);
  };
  process.on('SIGINT', salir);
  process.on('SIGTERM', salir);
});
