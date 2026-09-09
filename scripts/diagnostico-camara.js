// Diagnostico de camara, fuera de la app.
//
// Abre una ventana con las MISMAS opciones que usa GymApp (sandbox, aislamiento
// de contexto y el mismo manejador de permisos) y pide la camara. Sirve para
// separar dos cosas que desde la pantalla se ven igual: que la app este mal, o
// que Windows/el hardware no la esten dando.

const { app, BrowserWindow, session } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permiso, conceder) => {
    console.log('  permiso pedido:', permiso, '->', permiso === 'media' ? 'concedido' : 'negado');
    conceder(permiso === 'media');
  });

  const ventana = new BrowserWindow({
    width: 600, height: 400, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });

  await ventana.loadFile(path.join(__dirname, 'diag-camara.html'));

  const resultado = await ventana.webContents.executeJavaScript(`
    (async () => {
      const salida = { seguro: window.isSecureContext, origen: location.origin || location.protocol };
      try {
        const todos = await navigator.mediaDevices.enumerateDevices();
        salida.dispositivos = todos.filter(d => d.kind === 'videoinput')
          .map(d => ({ etiqueta: d.label || '(sin etiqueta hasta dar permiso)', id: d.deviceId.slice(0, 8) }));
      } catch (e) { salida.errorEnumerar = e.name + ': ' + e.message; }

      // Una por una, para saber cual de las tres arranca.
      salida.porDispositivo = [];
      for (const d of (salida.dispositivos || [])) {
        const entrada = (await navigator.mediaDevices.enumerateDevices())
          .filter(x => x.kind === 'videoinput')
          .find(x => x.deviceId.slice(0, 8) === d.id);
        try {
          const f = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: entrada.deviceId } } });
          salida.porDispositivo.push({ camara: d.etiqueta, arranca: true });
          f.getTracks().forEach(t => t.stop());
        } catch (e) {
          salida.porDispositivo.push({ camara: d.etiqueta, arranca: false, error: e.name });
        }
      }

      try {
        const flujo = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        const pista = flujo.getVideoTracks()[0];
        salida.abrio = true;
        salida.camara = pista ? pista.label : '(sin pista)';
        salida.ajustes = pista ? pista.getSettings() : null;
        flujo.getTracks().forEach(t => t.stop());
      } catch (e) {
        salida.abrio = false;
        salida.error = e.name;
        salida.mensaje = e.message;
      }
      return salida;
    })()
  `);

  console.log(JSON.stringify(resultado, null, 2));
  ventana.destroy();
  app.exit(0);
});
