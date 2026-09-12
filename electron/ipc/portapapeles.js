const { ipcMain, clipboard } = require('electron');

// Copiar al portapapeles desde el proceso principal.
//
// En el navegador, navigator.clipboard.writeText() no funciona aqui y no es un
// fallo que haya que arreglar aflojando nada: el handler de permisos de main.js
// concede la camara y niega todo lo demas, portapapeles incluido. Es una
// decision tomada a proposito.
//
// El modulo clipboard de Electron no pasa por esos permisos porque no es el
// navegador quien copia, sino la aplicacion. La pantalla pide, el proceso
// principal escribe.
//
// Existe por la lista de PIN: se genera una sola vez, no se puede volver a
// consultar, y perderla obliga a generarlos todos otra vez.
ipcMain.handle('sistema:copiar', (_evt, texto) => {
  const t = String(texto == null ? '' : texto);
  if (!t) return { ok: false, motivo: 'vacio' };
  clipboard.writeText(t);
  // Se relee para poder confirmar en pantalla que de verdad quedo copiado, en
  // vez de decir "copiado" a ciegas como hacia el boton de antes.
  return { ok: clipboard.readText() === t };
});

module.exports = {};
