const { ipcMain } = require('electron');
const { getDb } = require('../db/connection');

// La tabla `config` no guarda solo los datos del gimnasio: ahi viven tambien la
// DEK envuelta de cada usuario, la del escrow, la sal del cifrado, el token del
// sidecar y la contrasena de aplicacion del correo. Estos dos canales daban
// acceso de lectura y escritura a TODA la tabla desde la pantalla, asi que
// cualquier fallo que llegara a window.api podia leerse los secretos o pisar la
// envoltura de la DEK y dejar la base sin quien la abra.
//
// Lo que la pantalla necesita de verdad es poco y se puede nombrar: los datos
// del gimnasio y que camara usa este mostrador. Lo demas va por sus propios
// canales (setup, recordatorios, puerta), que si saben lo que hacen.
const ESCRIBIBLES = new Set([
  'gym_nombre', 'gym_direccion', 'gym_telefono', 'gym_nit',
  'camara_preferida',
]);

// Para leer se es algo mas ancho -- hay claves inofensivas que alguna pantalla
// consulta -- pero los secretos no salen de aqui por este camino.
function esSecreto(clave) {
  const c = String(clave || '');
  return c.startsWith('dek_') || c === 'kdf_salt' || c === 'sidecar_token'
      || c === 'recordatorios_smtp_pass';
}

ipcMain.handle('config:get', (_evt, clave) => {
  if (esSecreto(clave)) return null;
  const row = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  return row ? row.valor : null;
});

ipcMain.handle('config:set', (_evt, clave, valor) => {
  if (!ESCRIBIBLES.has(String(clave || ''))) return false;
  getDb().prepare(
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  ).run(clave, valor);
  return true;
});
