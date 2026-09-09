// Interruptor de "hay un desarrollador dentro", vivo solo en memoria del proceso
// principal.
//
// Existe porque el panel de desarrollador borra bases enteras, y no basta con
// que la pantalla se esconda: cualquier fallo del renderer que consiga llamar a
// window.api tendria las mismas herramientas a mano. La puerta se abre en
// auth:accesoDesarrollador, que exige la passphrase, y se cierra al entrar por
// el login normal o al cerrar sesion.
//
// No se persiste a proposito: al reiniciar la app la puerta vuelve a estar
// cerrada, aunque la ultima sesion la hubiera dejado abierta.
let activa = false;

module.exports = {
  activar() { activa = true; },
  desactivar() { activa = false; },
  estaActiva() { return activa; },
};
