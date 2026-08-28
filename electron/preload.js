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
  desbloqueo: {
    intentar: (passphrase) => ipcRenderer.invoke('desbloqueo:intentar', passphrase),
    estaDesbloqueado: () => ipcRenderer.invoke('desbloqueo:estaDesbloqueado'),
},

 backup: {
    generar: () => ipcRenderer.invoke('backup:generar'),
    listar: () => ipcRenderer.invoke('backup:listar'),
    restaurar: (ruta) => ipcRenderer.invoke('backup:restaurar', ruta),
  },

  auth: {
  login: (usuario, password) => ipcRenderer.invoke('auth:login', usuario, password),
},

clientes: {
  crear: (cliente) => ipcRenderer.invoke('clientes:crear', cliente),
  buscar: (texto) => ipcRenderer.invoke('clientes:buscar', texto),
  obtener: (id) => ipcRenderer.invoke('clientes:obtener', id),
  editar: (id, cambios) => ipcRenderer.invoke('clientes:editar', id, cambios),
  asignarPin: (id, pin) => ipcRenderer.invoke('clientes:asignarPin', id, pin),
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

productos: {
  crear: (producto) => ipcRenderer.invoke('productos:crear', producto),
  listar: () => ipcRenderer.invoke('productos:listar'),
  listarTodos: () => ipcRenderer.invoke('productos:listarTodos'),
  obtener: (id) => ipcRenderer.invoke('productos:obtener', id),
  obtenerPorCodigo: (codigo) => ipcRenderer.invoke('productos:obtenerPorCodigo', codigo),
  editar: (id, cambios) => ipcRenderer.invoke('productos:editar', id, cambios),
  desactivar: (id) => ipcRenderer.invoke('productos:desactivar', id),
  activar: (id) => ipcRenderer.invoke('productos:activar', id),
  ajustarStock: (datos) => ipcRenderer.invoke('productos:ajustarStock', datos),
  listarBajoMinimo: () => ipcRenderer.invoke('productos:listarBajoMinimo'),
  historialStock: (id) => ipcRenderer.invoke('productos:historialStock', id),
},

caja: {
  sesionAbierta: () => ipcRenderer.invoke('caja:sesionAbierta'),
  abrir: (datos) => ipcRenderer.invoke('caja:abrir', datos),
  registrarMovimiento: (datos) => ipcRenderer.invoke('caja:registrarMovimiento', datos),
  resumen: (sesionId) => ipcRenderer.invoke('caja:resumen', sesionId),
  cerrar: (datos) => ipcRenderer.invoke('caja:cerrar', datos),
  listarSesiones: (limite) => ipcRenderer.invoke('caja:listarSesiones', limite),
},

membresias: {
  vender: (datos) => ipcRenderer.invoke('membresias:vender', datos),
  registrarPago: (datos) => ipcRenderer.invoke('membresias:registrarPago', datos),
  listarPorCliente: (clienteId) => ipcRenderer.invoke('membresias:listarPorCliente', clienteId),
  listarPagos: (membresiaId) => ipcRenderer.invoke('membresias:listarPagos', membresiaId),
},

pausas: {
  pausar: (datos) => ipcRenderer.invoke('pausas:pausar', datos),
  reactivar: (membresiaId) => ipcRenderer.invoke('pausas:reactivar', membresiaId),
  listarPorMembresia: (membresiaId) => ipcRenderer.invoke('pausas:listarPorMembresia', membresiaId),
},

asistencias: {
  registrar: (datos) => ipcRenderer.invoke('asistencias:registrar', datos),
  listarDelDia: (fecha) => ipcRenderer.invoke('asistencias:listarDelDia', fecha),
},

kiosco: {
  marcarPorPin: (datos) => ipcRenderer.invoke('kiosco:marcarPorPin', datos),
},

});