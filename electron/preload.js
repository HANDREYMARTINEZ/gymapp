const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  config: {
    get: (clave) => ipcRenderer.invoke('config:get', clave),
    set: (clave, valor) => ipcRenderer.invoke('config:set', clave, valor),
  },
  setup: {
    estado: () => ipcRenderer.invoke('setup:estado'),
    guardarDatosGimnasio: (datos) => ipcRenderer.invoke('setup:datos-gimnasio', datos),
    crearAdmin: (datos) => ipcRenderer.invoke('setup:crear-admin', datos),
    finalizar: (passphrase) => ipcRenderer.invoke('setup:finalizar', passphrase),
  },

  auth: {
  login: (usuario, password) => ipcRenderer.invoke('auth:login', usuario, password),
},
});