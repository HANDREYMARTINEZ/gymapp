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
  // Ninguna pantalla los usa hoy y es deliberado: son la puerta de recuperacion
  // por escrow, que se conserva sin entrada en la interfaz. Ver el comentario de
  // electron/ipc/desbloqueo.js antes de borrarlos por "codigo muerto".
  desbloqueo: {
    intentar: (passphrase) => ipcRenderer.invoke('desbloqueo:intentar', passphrase),
    dev: (clavePrivadaPem) => ipcRenderer.invoke('desbloqueo:dev', clavePrivadaPem),
    estaDesbloqueado: () => ipcRenderer.invoke('desbloqueo:estaDesbloqueado'),
},

  // Exportar / importar clientes y membresias, y los dialogos nativos de archivo.
  intercambio: {
    exportar: (formato) => ipcRenderer.invoke('intercambio:exportar', formato),
    revisar: () => ipcRenderer.invoke('intercambio:revisar'),
    importarRuta: (datos) => ipcRenderer.invoke('intercambio:importarRuta', datos),
    respaldoEn: () => ipcRenderer.invoke('intercambio:respaldoEn'),
    mostrarEnCarpeta: (ruta) => ipcRenderer.invoke('intercambio:mostrarEnCarpeta', ruta),
  },

 backup: {
    generar: () => ipcRenderer.invoke('backup:generar'),
    listar: () => ipcRenderer.invoke('backup:listar'),
    restaurar: (ruta) => ipcRenderer.invoke('backup:restaurar', ruta),
  },

  // Panel de desarrollador. El proceso principal comprueba en cada llamada que
  // la passphrase se haya escrito en esta sesion; esto solo es el cable.
  desarrollador: {
    diagnostico: () => ipcRenderer.invoke('dev:diagnostico'),
    zonas: () => ipcRenderer.invoke('dev:zonas'),
    vaciar: (zonas) => ipcRenderer.invoke('dev:vaciar', zonas),
    resetFabrica: () => ipcRenderer.invoke('dev:resetFabrica'),
    borrarCopiasAntiguas: () => ipcRenderer.invoke('dev:borrarCopiasAntiguas'),
    eliminarRespaldo: (ruta) => ipcRenderer.invoke('dev:eliminarRespaldo', ruta),
    resetearPassword: (datos) => ipcRenderer.invoke('dev:resetearPassword', datos),
    usuarios: () => ipcRenderer.invoke('dev:usuarios'),
    auditoria: (filtros) => ipcRenderer.invoke('dev:auditoria', filtros),
    sembrarDemo: () => ipcRenderer.invoke('dev:sembrarDemo'),
  },

  // Recordatorios de vencimiento por correo.
  recordatorios: {
    estado: () => ipcRenderer.invoke('recordatorios:estado'),
    previsualizar: () => ipcRenderer.invoke('recordatorios:previsualizar'),
    guardar: (datos) => ipcRenderer.invoke('recordatorios:guardar', datos),
    verificar: () => ipcRenderer.invoke('recordatorios:verificar'),
    prueba: () => ipcRenderer.invoke('recordatorios:prueba'),
    vistaPrevia: (tipo) => ipcRenderer.invoke('recordatorios:vistaPrevia', tipo),
    enviarAhora: () => ipcRenderer.invoke('recordatorios:enviarAhora'),
    historial: (limite) => ipcRenderer.invoke('recordatorios:historial', limite),
  },

  auth: {
  login: (usuario, password) => ipcRenderer.invoke('auth:login', usuario, password),
  cerrarSesion: () => ipcRenderer.invoke('auth:cerrarSesion'),
  vincularPassphrase: (datos) => ipcRenderer.invoke('auth:vincularPassphrase', datos),
  accesoDesarrollador: (passphrase) => ipcRenderer.invoke('auth:accesoDesarrollador', passphrase),
  estaAbierto: () => ipcRenderer.invoke('auth:estaAbierto'),
},

usuarios: {
  listar: () => ipcRenderer.invoke('usuarios:listar'),
  obtener: (id) => ipcRenderer.invoke('usuarios:obtener', id),
  crear: (datos) => ipcRenderer.invoke('usuarios:crear', datos),
  editar: (id, cambios) => ipcRenderer.invoke('usuarios:editar', id, cambios),
  cambiarPassword: (datos) => ipcRenderer.invoke('usuarios:cambiarPassword', datos),
  desactivar: (id) => ipcRenderer.invoke('usuarios:desactivar', id),
  activar: (id) => ipcRenderer.invoke('usuarios:activar', id),
  roles: () => ipcRenderer.invoke('usuarios:roles'),
},

clientes: {
  crear: (cliente) => ipcRenderer.invoke('clientes:crear', cliente),
  buscar: (texto) => ipcRenderer.invoke('clientes:buscar', texto),
  buscarConEstado: (texto) => ipcRenderer.invoke('clientes:buscarConEstado', texto),
  panelLateral: () => ipcRenderer.invoke('clientes:panelLateral'),
  obtener: (id) => ipcRenderer.invoke('clientes:obtener', id),
  editar: (id, cambios) => ipcRenderer.invoke('clientes:editar', id, cambios),
  asignarPin: (id, pin) => ipcRenderer.invoke('clientes:asignarPin', id, pin),
  tienePin: (id) => ipcRenderer.invoke('clientes:tienePin', id),
  quitarPin: (id) => ipcRenderer.invoke('clientes:quitarPin', id),
  asignarPinEnLote: (datos) => ipcRenderer.invoke('clientes:asignarPinEnLote', datos),
  pinesResumen: () => ipcRenderer.invoke('clientes:pinesResumen'),
  darDeBaja: (datos) => ipcRenderer.invoke('clientes:darDeBaja', datos),
  reactivar: (datos) => ipcRenderer.invoke('clientes:reactivar', datos),
  listarDadosDeBaja: () => ipcRenderer.invoke('clientes:listarDadosDeBaja'),
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

ventas: {
  registrar: (datos) => ipcRenderer.invoke('ventas:registrar', datos),
  obtener: (ventaId) => ipcRenderer.invoke('ventas:obtener', ventaId),
  listarDelDia: (fecha) => ipcRenderer.invoke('ventas:listarDelDia', fecha),
  totalesDelDia: (fecha) => ipcRenderer.invoke('ventas:totalesDelDia', fecha),
  fueraDeCajaDelDia: (fecha) => ipcRenderer.invoke('ventas:fueraDeCajaDelDia', fecha),
  fueraDeCajaEntre: (desde, hasta) => ipcRenderer.invoke('ventas:fueraDeCajaEntre', desde, hasta),
  anular: (datos) => ipcRenderer.invoke('ventas:anular', datos),
  mediosPago: () => ipcRenderer.invoke('ventas:mediosPago'),
},

dashboard: {
  resumen: (opciones) => ipcRenderer.invoke('dashboard:resumen', opciones),
  ingresosDelDia: (fecha) => ipcRenderer.invoke('dashboard:ingresosDelDia', fecha),
  porVencer: (diasAviso) => ipcRenderer.invoke('dashboard:porVencer', diasAviso),
},

membresias: {
  vender: (datos) => ipcRenderer.invoke('membresias:vender', datos),
  anular: (datos) => ipcRenderer.invoke('membresias:anular', datos),
  renovar: (datos) => ipcRenderer.invoke('membresias:renovar', datos),
  cambiarFechaInicio: (datos) => ipcRenderer.invoke('membresias:cambiarFechaInicio', datos),
  registrarPago: (datos) => ipcRenderer.invoke('membresias:registrarPago', datos),
  listarPorCliente: (clienteId) => ipcRenderer.invoke('membresias:listarPorCliente', clienteId),
  pagosDelDia: (fecha) => ipcRenderer.invoke('membresias:pagosDelDia', fecha),
  listarPagos: (membresiaId) => ipcRenderer.invoke('membresias:listarPagos', membresiaId),
  ajustarTickets: (datos) => ipcRenderer.invoke('membresias:ajustarTickets', datos),
  estadoTickets: (membresiaId) => ipcRenderer.invoke('membresias:estadoTickets', membresiaId),
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


huellas: {
  enrolar: (clienteId, dedo) => ipcRenderer.invoke('huellas:enrolar', { clienteId, dedo }),
  listarPorCliente: (clienteId) => ipcRenderer.invoke('huellas:listarPorCliente', clienteId),
  eliminar: (clienteId, dedo) => ipcRenderer.invoke('huellas:eliminar', clienteId, dedo),
},

// Mecanismo unico de imagenes: foto de cliente, imagen de producto y logo del
// gimnasio. obtener() devuelve un data URL listo para el src de una <img>, o
// null si esa cosa no tiene imagen todavia.
imagenes: {
  guardar: (datos) => ipcRenderer.invoke('imagenes:guardar', datos),
  obtener: (entidad, entidadId) => ipcRenderer.invoke('imagenes:obtener', entidad, entidadId),
  obtenerVarias: (entidad, ids) => ipcRenderer.invoke('imagenes:obtenerVarias', entidad, ids),
  existe: (entidad, entidadId) => ipcRenderer.invoke('imagenes:existe', entidad, entidadId),
  eliminar: (entidad, entidadId) => ipcRenderer.invoke('imagenes:eliminar', entidad, entidadId),
},

// Copiar al portapapeles lo hace el proceso principal: el handler de permisos
// de main.js le niega el portapapeles al navegador a proposito.
sistema: {
  copiar: (texto) => ipcRenderer.invoke('sistema:copiar', texto),
},

kiosco: {
  marcarPorPin: (datos) => ipcRenderer.invoke('kiosco:marcarPorPin', datos),
  iniciarEscuchaHuella: () => ipcRenderer.invoke('kiosco:iniciarEscuchaHuella'),
  onHuellaDetectada: (callback) => ipcRenderer.on('kiosco:huellaDetectada', (_evt, data) => callback(data)),
},


});