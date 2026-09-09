const { ipcMain, dialog, BrowserWindow, shell } = require('electron');
const path = require('path');
const { format } = require('date-fns');
const intercambio = require('../services/intercambio');
const backup = require('../services/backup');

// Los dialogos de archivo van con la ventana como padre. Es distinto de los
// showMessageBox que se quitaron en su dia por congelar la app: aquellos se
// usaban para confirmar cosas que la propia pantalla podia preguntar, mientras
// que elegir donde guardar sin el explorador de Windows no tiene sustituto
// razonable -- obligaria a escribir la ruta a mano.
function ventanaDe(evt) {
  return BrowserWindow.fromWebContents(evt.sender);
}

const sello = () => format(new Date(), 'yyyy-MM-dd');

ipcMain.handle('intercambio:exportar', async (evt, formato) => {
  const esJson = formato === 'json';
  const r = await dialog.showSaveDialog(ventanaDe(evt), {
    title: 'Guardar el listado de clientes',
    defaultPath: `clientes-gymapp-${sello()}.${esJson ? 'json' : 'xlsx'}`,
    filters: esJson
      ? [{ name: 'JSON', extensions: ['json'] }]
      : [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, motivo: 'cancelado' };

  try {
    return esJson ? intercambio.exportarJson(r.filePath) : await intercambio.exportarExcel(r.filePath);
  } catch (e) {
    return { ok: false, motivo: 'error_al_escribir', detalle: e.message };
  }
});

// Vista previa: lee el archivo y cuenta lo que haria, sin escribir nada. Importar
// toca clientes, membresias y pagos a la vez; poder mirar antes lo que va a pasar
// es lo que separa "cargar el Excel" de "a ver que sale".
ipcMain.handle('intercambio:revisar', async (evt) => {
  const r = await dialog.showOpenDialog(ventanaDe(evt), {
    title: 'Elegir el Excel de clientes',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }],
  });
  if (r.canceled || r.filePaths.length === 0) return { ok: false, motivo: 'cancelado' };

  try {
    const lectura = await intercambio.leerFilas(r.filePaths[0]);
    if (!lectura.ok) return lectura;

    // La vista previa tiene que rechazar exactamente lo mismo que rechaza la
    // importacion. Sin esto ofrecia importar un archivo sin columna Documento,
    // el usuario decia que si, y solo entonces se le decia que no se podia.
    if (!lectura.mapa.documento) {
      return { ok: false, motivo: 'falta_columna_documento', filas: lectura.filas.length };
    }

    const { getDb } = require('../db/connection');
    const db = getDb();
    let nuevos = 0, existentes = 0, sinDocumento = 0;
    for (const f of lectura.filas) {
      // Ya no se saltan: entran con cedula provisional. Se cuentan aparte para
      // poder decir cuantas van a entrar asi antes de escribir nada.
      if (!f.documento) { sinDocumento++; continue; }
      if (db.prepare(`SELECT 1 FROM clientes WHERE documento = ?`).get(f.documento)) existentes++;
      else nuevos++;
    }
    return { ok: true, ruta: r.filePaths[0], nombre: path.basename(r.filePaths[0]),
             filas: lectura.filas.length, nuevos, existentes, sinDocumento };
  } catch (e) {
    return { ok: false, motivo: 'error_al_leer', detalle: e.message };
  }
});

ipcMain.handle('intercambio:importarRuta', async (_evt, { ruta, usuarioId } = {}) => {
  try {
    return await intercambio.importarExcel(ruta, { usuarioId });
  } catch (e) {
    return { ok: false, motivo: 'error_al_leer', detalle: e.message };
  }
});

// 5.17 pide el selector de carpeta tambien para los respaldos, que hasta ahora
// se guardaban siempre en la misma ruta fija dentro de userData.
ipcMain.handle('intercambio:respaldoEn', async (evt) => {
  const r = await dialog.showSaveDialog(ventanaDe(evt), {
    title: 'Guardar una copia del respaldo',
    defaultPath: `gymapp-respaldo-${sello()}.gymbak`,
    filters: [{ name: 'Respaldo de GymApp', extensions: ['gymbak'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, motivo: 'cancelado' };

  try {
    const generado = await backup.generarRespaldo();
    if (!generado.ok) return generado;
    require('fs').copyFileSync(generado.ruta, r.filePath);
    return { ok: true, ruta: r.filePath };
  } catch (e) {
    return { ok: false, motivo: 'error_al_escribir', detalle: e.message };
  }
});

ipcMain.handle('intercambio:mostrarEnCarpeta', (_evt, ruta) => {
  if (ruta) shell.showItemInFolder(ruta);
  return true;
});

module.exports = {};
