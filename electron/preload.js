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

clientes: {
  crear: (cliente) => ipcRenderer.invoke('clientes:crear', cliente),
  buscar: (texto) => ipcRenderer.invoke('clientes:buscar', texto),
  obtener: (id) => ipcRenderer.invoke('clientes:obtener', id),
  editar: (id, cambios) => ipcRenderer.invoke('clientes:editar', id, cambios),
},
planes: {
  crear: (plan) => ipcRenderer.invoke('planes:crear', plan),
  listar: () => ipcRenderer.invoke('planes:listar'),
  obtener: (id) => ipcRenderer.invoke('planes:obtener', id),
  editar: (id, cambios) => ipcRenderer.invoke('planes:editar', id, cambios),
  desactivar: (id) => ipcRenderer.invoke('planes:desactivar', id),
  activar: (id) => ipcRenderer.invoke('planes:activar', id),
  listarTodos: () => ipcRenderer.invoke('planes:listarTodos'), 
},
});