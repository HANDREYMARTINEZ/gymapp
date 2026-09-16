const { ipcMain } = require('electron');
const recordatorios = require('../services/recordatorios');
const correo = require('../services/correo');

ipcMain.handle('recordatorios:estado', () => {
  const config = recordatorios.leerConfig();
  const lista = recordatorios.destinatarios(config);
  return {
    ok: true,
    config,
    proxima: recordatorios.proximaRonda(config),
    // El censo va aqui dentro y no en un canal aparte porque la pantalla de
    // Configuracion ya llama a este al abrirse, y el numero hace falta en dos
    // sitios de ella: junto a exportar/importar (donde se consiguen los correos)
    // y junto a los recordatorios (donde se usan).
    censo: recordatorios.censoCorreos(),
    resumen: {
      porEnviar: lista.porEnviar.length,
      vencidas: lista.porEnviar.filter(d => d.tipo === 'vencida').length,
      porVencer: lista.porEnviar.filter(d => d.tipo === 'por_vencer').length,
      yaAvisados: lista.yaAvisados.length,
      sinCorreo: lista.sinCorreo.length,
      correoInvalido: lista.correoInvalido.length,
    },
  };
});

// La lista completa, con nombre y correo de cada uno. Se mira antes de mandar
// nada: la primera ronda de correos de verdad no se lanza a ciegas.
ipcMain.handle('recordatorios:previsualizar', (_evt, opciones) => {
  const config = recordatorios.leerConfig();
  // Con repetir=true la lista incluye tambien a los que ya recibieron el aviso en
  // este periodo, que es justo lo que se quiere ver antes de reenviar.
  return { ok: true, ...recordatorios.destinatarios(config, { repetir: !!(opciones && opciones.repetir) }) };
});

ipcMain.handle('recordatorios:guardar', (_evt, { config, password }) => {
  recordatorios.guardarConfig(config);
  // La contrasena solo se toca si la pantalla manda una. undefined significa "no
  // la cambies"; cadena vacia significa "borrala".
  if (password !== undefined) {
    const r = correo.guardarPassword(password);
    if (!r.ok) return r;
  }
  return { ok: true, config: recordatorios.leerConfig() };
});

// Comprueba usuario y contrasena contra Gmail sin mandarle nada a nadie.
ipcMain.handle('recordatorios:verificar', async () => {
  const config = recordatorios.leerConfig();
  const password = correo.leerPassword();
  if (!config.remitente) return { ok: false, motivo: 'Falta el correo del remitente.' };
  if (!password) return { ok: false, motivo: 'Falta la contraseña de aplicación.' };
  return correo.verificar({ remitente: config.remitente, password });
});

ipcMain.handle('recordatorios:prueba', () => recordatorios.enviarPrueba());

ipcMain.handle('recordatorios:vistaPrevia', (_evt, tipo) => recordatorios.vistaPrevia(tipo));

ipcMain.handle('recordatorios:enviarAhora', (_evt, opciones) =>
  recordatorios.enviarRonda({ manual: true, repetir: !!(opciones && opciones.repetir) }));

ipcMain.handle('recordatorios:historial', (_evt, limite) => ({
  ok: true, filas: recordatorios.historial(limite),
}));

module.exports = {};
