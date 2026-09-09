// Abre el ejemplo original de DigitalPersona, tal cual venia en el SDK, pero
// desde nuestro ejecutable y con nuestras mismas DLL.
//
// Es la prueba que separa las dos posibilidades: si el lector responde aqui, el
// equipo y el driver estan bien y el problema es de nuestro sidecar; si tampoco
// responde aqui, el problema esta antes de nuestro codigo.
const { app } = require('electron');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const conn = require('../electron/db/connection');
  conn.conectar();
  const proceso = require('../electron/services/sidecarProceso');

  const exe = proceso.rutaExe();
  if (!exe) {
    console.log('No se encontró SidecarHuella.exe. Compílalo primero.');
    app.exit(1);
    return;
  }

  console.log('');
  console.log('Abriendo el ejemplo original del SDK:');
  console.log('  ' + exe);
  console.log('');
  console.log('  1. Pulsa "Fingerprint Enrollment".');
  console.log('  2. Pon el dedo en el lector cuatro veces.');
  console.log('');
  console.log('Si ahí SÍ lee la huella, el lector y el driver están bien.');
  console.log('Si tampoco lee, el problema está antes de nuestro código.');
  console.log('');
  console.log('Registro: ' + path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'GymApp', 'sidecar.log'));
  console.log('Cierra la ventana del ejemplo para terminar.');

  const hijo = spawn(exe, ['muestra'], { cwd: path.dirname(exe), stdio: 'ignore' });
  hijo.on('exit', () => app.exit(0));
});
