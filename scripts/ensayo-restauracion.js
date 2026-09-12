// Ensayo de restauracion sobre una COPIA de los datos reales.
//
// Restaurar un respaldo es de esas cosas que solo se descubren rotas el dia que
// hacen falta. Este guion abre la app de verdad -- su login, su cifrado, su
// pantalla de respaldos -- pero apuntando a una copia de la carpeta de datos,
// asi que se puede ensayar el dia que no pasa nada sin arriesgar el dia que si.
//
// Uso:
//   npm run build:vite            (una vez, si no hay dist/)
//   npm run ensayo:restauracion
//
// Lo que hace:
//   1. Copia gym.db y la carpeta respaldos/ de los datos reales a un temporal.
//   2. Abre la app apuntada a esa copia. Se entra con el usuario de siempre.
//   3. Configuracion -> Respaldos -> Restaurar. La app pide reiniciar.
//   4. Se vuelve a lanzar el mismo comando: la copia ya esta, no se re-copia, y
//      al arrancar se aplica la restauracion pendiente. Se comprueba en
//      Clientes que esten los que tenian que estar.
//
// Con --limpiar borra la copia y empieza de cero.

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COPIA = path.join(os.tmpdir(), 'gymapp-ensayo-restauracion');
const limpiar = process.argv.includes('--limpiar');

// Lanzado como 'electron scripts/...js', Electron se cree que la app se llama
// 'Electron' y apunta userData a Roaming/Electron, que no son los datos del
// gimnasio sino una carpeta de pruebas. Con el nombre puesto a mano apunta a
// Roaming/gymapp, que es lo que usa la app de verdad.
app.setName('gymapp');

// Hay que preguntar por la carpeta real ANTES de cambiarla: despues de
// setPath, getPath('userData') ya devuelve la copia.
const REAL = app.getPath('userData');

if (limpiar && fs.existsSync(COPIA)) {
  fs.rmSync(COPIA, { recursive: true, force: true });
  console.log('Copia anterior borrada.');
}

const yaExiste = fs.existsSync(path.join(COPIA, 'gym.db'));

if (!yaExiste) {
  if (!fs.existsSync(path.join(REAL, 'gym.db'))) {
    console.error('No hay datos reales que copiar en: ' + REAL);
    app.exit(1);
  }

  fs.mkdirSync(COPIA, { recursive: true });

  // El -wal y el -shm van con la base o SQLite lee una cosa por otra.
  for (const sufijo of ['', '-wal', '-shm']) {
    const origen = path.join(REAL, 'gym.db' + sufijo);
    if (fs.existsSync(origen)) fs.copyFileSync(origen, path.join(COPIA, 'gym.db' + sufijo));
  }

  const respaldosReales = path.join(REAL, 'respaldos');
  if (fs.existsSync(respaldosReales)) {
    const destino = path.join(COPIA, 'respaldos');
    fs.mkdirSync(destino, { recursive: true });
    for (const nombre of fs.readdirSync(respaldosReales)) {
      fs.copyFileSync(path.join(respaldosReales, nombre), path.join(destino, nombre));
    }
  }

  console.log('Copia recien hecha desde: ' + REAL);
} else {
  console.log('Se reutiliza la copia que ya estaba (asi se aplica la restauracion pendiente).');
}

app.setPath('userData', COPIA);

console.log('');
console.log('   ENSAYO DE RESTAURACION -- los datos reales NO se tocan');
console.log('   Datos reales:  ' + REAL);
console.log('   Copia en uso:  ' + COPIA);
console.log('');
console.log('   Entra con tu usuario, ve a Configuracion -> Respaldos, restaura');
console.log('   uno, y cuando pida reiniciar cierra y vuelve a lanzar este mismo');
console.log('   comando. Al volver, mira Clientes.');
console.log('');

require('../electron/main.js');
