const { ipcMain } = require('electron');
const puerta = require('../services/puerta');
const { getDb } = require('../db/connection');

function guardarConfig(clave, valor) {
  getDb().prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  ).run(clave, String(valor));
}

ipcMain.handle('puerta:estado', () => puerta.estado());

ipcMain.handle('puerta:puertos', () => puerta.listarPuertos());

// Sondea los COM buscando el que conteste con nuestra firma. Si lo encuentra lo
// deja guardado: es lo que hace que "no se por que puerto entra" deje de ser un
// problema del que atiende el mostrador.
ipcMain.handle('puerta:detectar', async () => {
  const r = await puerta.detectar();
  if (r.ok) guardarConfig('puerta_puerto', r.puerto);
  return r;
});

ipcMain.handle('puerta:guardar', async (_evt, { activa, puerto: nombre, segundos }) => {
  const n = parseInt(segundos, 10);
  if (!Number.isFinite(n) || n < puerta.SEGUNDOS_MIN || n > puerta.SEGUNDOS_MAX) {
    return { ok: false, motivo: 'segundos_invalidos' };
  }

  guardarConfig('puerta_activa', activa ? '1' : '0');
  guardarConfig('puerta_puerto', nombre || '');
  guardarConfig('puerta_segundos', n);

  // El puerto pudo cambiar. Se suelta el que hubiera ESPERANDO a que Windows lo
  // libere de verdad (menos de un segundo): sin esa espera, pulsar "Abrir ahora"
  // justo despues de Guardar intentaba abrir un COM todavia cogido por la
  // conexion vieja. La reconexion si va en segundo plano -- cuesta el reset de la
  // placa -- y si "Abrir ahora" llega antes, se engancha a ella.
  await puerta.cerrar();
  puerta.arrancar();
  return { ok: true };
});

// Abre de verdad, aunque la puerta este desactivada: es un boton de prueba, y
// probarla antes de activarla es justo el orden sensato.
ipcMain.handle('puerta:probar', async () => puerta.pulso());

module.exports = {};
