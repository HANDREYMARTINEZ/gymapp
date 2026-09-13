// Diagnostico del Arduino que abre la puerta.
//
//   npm run puerta             -> lista los puertos serie y dice cual responde
//   npm run puerta -- --abrir  -> ademas comprueba un ciclo de apertura entero
//
// Sirve para lo unico que no se puede saber desde la app cuando algo no va: si
// el problema es que Windows no ve la placa (falta el driver FTDI), que la ve
// pero no contesta (falta grabarle el sketch), o que contesta y entonces el
// fallo esta en la configuracion de la app.
//
// Se corre con electron y no con node a proposito: asi carga el mismo binario
// nativo de serialport que usara la app, y un fallo de ABI sale aqui y no
// delante de un cliente.

const { app } = require('electron');
const puerta = require('../electron/services/puerta');

const abrirDeVerdad = process.argv.includes('--abrir');
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const log = (t) => process.stdout.write(t + '\n');
  let fallos = 0;
  const check = (texto, bien, extra) => {
    log('  ' + (bien ? '[bien]  ' : '[MAL]   ') + texto + (extra ? '   ' + extra : ''));
    if (!bien) fallos++;
  };

  // Marca de ejecucion. Parece un detalle tonto y no lo es: una vez salio el
  // diagnostico entero DOS veces bajo un solo prompt y costo un rato saber si
  // el guion se estaba ejecutando dos veces o si eran dos procesos (era lo
  // segundo: teclas que se quedaron en la cola de PowerShell). Con el numero de
  // proceso a la vista, eso se responde de un vistazo.
  const ahora = new Date();
  const dosCifras = (n) => String(n).padStart(2, '0');
  log('');
  log('=== Diagnostico de la puerta  (proceso ' + process.pid + ', ' +
      dosCifras(ahora.getHours()) + ':' + dosCifras(ahora.getMinutes()) + ':' +
      dosCifras(ahora.getSeconds()) + ') ===');

  log('');
  log('=== Puertos serie que ve Windows ===');
  const puertos = await puerta.listarPuertos();

  if (puertos.length === 0) {
    log('  (ninguno)');
    log('');
    log('Windows no ve ningun puerto COM. Casi siempre es una de dos:');
    log('  - el Arduino no esta enchufado, o el cable es de solo carga;');
    log('  - falta el driver FTDI (el Nano V3.0 FT232 lo necesita).');
    app.exit(1);
    return;
  }

  for (const p of puertos) {
    log('  ' + p.puerto.padEnd(6) + '  ' +
        (p.esFtdi ? '[FTDI]' : '      ') + '  ' +
        (p.descripcion || '') +
        (p.fabricante ? '  (' + p.fabricante + ')' : ''));
  }

  log('');
  log('=== Cual de ellos es el nuestro ===');
  const encontrado = await puerta.detectar();
  if (!encontrado.ok) {
    // Antes aqui salia siempre "falta grabarle el sketch", que manda a rehacer
    // la grabacion aunque el problema sea otro. Ahora se dice puerto por puerto
    // que paso, porque los dos motivos se arreglan de forma muy distinta.
    for (const x of (encontrado.porQue || [])) {
      log('  ' + x.puerto + ': ' + (x.motivo === 'no_abre'
        ? 'no se deja abrir -- lo tiene cogido otro programa'
        : 'se abre, pero no contesta'));
    }
    log('');
    if (encontrado.motivo === 'puerto_ocupado') {
      log('  Hay un puerto OCUPADO. Casi siempre es una de estas tres:');
      log('    - el Monitor Serie del IDE de Arduino esta abierto;');
      log('    - GymApp esta corriendo (tiene el puerto cogido mientras vive);');
      log('    - quedo otro diagnostico a medias.');
      log('  Cierralos y vuelve a intentarlo. NO hace falta volver a grabar la placa.');
    } else {
      log('  Windows ve el puerto pero la placa no contesta: le falta el sketch');
      log('  arduino/gymapp-puerta, o no se grabo bien. Vuelve al paso 4 de la guia');
      log('  y acuerdate del "ATmega328P (Old Bootloader)".');
    }
    app.exit(1);
    return;
  }

  log('  ' + encontrado.puerto + ' responde: ' + encontrado.firma);

  if (!abrirDeVerdad) {
    log('');
    log('  (para comprobar un ciclo de apertura entero: npm run puerta -- --abrir)');
    await puerta.cerrar();
    app.exit(0);
    return;
  }

  // ---------------------------------------------------------- ciclo entero
  //
  // No basta con mandar la orden y decir "enviado". Lo que hay que demostrar es
  // que la placa CIERRA SOLA, porque ese es el comportamiento del que depende
  // que la puerta de la calle no se quede abierta cuando el PC falle. Aqui se
  // manda el pulso y despues se le pregunta a la placa, sin volver a mandarle
  // nada, si ya cerro.
  const COM = encontrado.puerto;
  const pregunta = async (orden, ms) => {
    const r = await puerta.consultar(orden, ms, COM);
    return r.ok ? r.respuesta : '(' + r.motivo + ')';
  };

  log('');
  log('=== Ciclo de apertura en ' + COM + ' ===');
  log('  Mira el LED de la placa: tiene que encenderse y apagarse solo.');
  log('');

  const enReposo = await pregunta('ESTADO');
  check('en reposo la puerta esta cerrada', enReposo === 'CERRADA', '-> ' + enReposo);

  const alAbrir = await pregunta('ABRIR:5000');
  check('acepta la orden de abrir 5 segundos', alAbrir === 'ABIERTA:5000', '-> ' + alAbrir);

  await esperar(2000);
  const aMitad = await pregunta('ESTADO');
  const restante = /^ABIERTA:(\d+)$/.exec(aMitad);
  check('a los 2 s sigue abierta y le queda tiempo',
        !!restante && +restante[1] > 2000 && +restante[1] < 3200,
        '-> ' + aMitad);

  // Nadie le manda CERRAR. Si a los 6 s esta cerrada, es porque el reloj corre
  // dentro de la placa, que es justo lo que habia que demostrar.
  await esperar(4000);
  const alFinal = await pregunta('ESTADO');
  check('a los 6 s cerro sola, sin que nadie se lo mandara',
        alFinal === 'CERRADA', '-> ' + alFinal);

  log('');
  log(fallos === 0
    ? 'CICLO CORRECTO. La placa abre, cuenta el tiempo ella sola y cierra.'
    : fallos + ' comprobacion(es) mal. Revisa el paso 4 de la guia de instalacion.');

  await puerta.cerrar();
  log('');
  app.exit(fallos === 0 ? 0 : 1);
});
