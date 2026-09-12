// Convierte una imagen en el icono de Windows de la app: build/icon.ico.
//
// electron-builder coge solo build/icon.ico (es la carpeta buildResources), asi
// que con generarlo ahi ya entra en el instalador, en el ejecutable y en el
// acceso directo. Sin el, Windows pone el icono por defecto de Electron y la
// app parece de otro.
//
// No hace falta ffmpeg ni ImageMagick: Chromium sabe abrir png/jpg/webp y el
// canvas sabe reescalar, que es todo lo que un .ico necesita.
//
// Uso:
//   npm run icono -- "ruta/al/logo.png"
//   npm run icono -- "ruta/al/logo.png" --recorte 70,55,320,320
//   npm run icono -- "ruta/al/logo.png" --recorte-chico 145,145,270,160
//   npm run icono -- "ruta/al/logo.png" --sin-fondo
//
// El de DR GYM se hace asi:
//   npm run icono -- "F:\gymapp V2\Logo.png" --recorte 50,42,428,398 --recorte-chico 145,145,270,160
//
// El recorte (x,y,ancho,alto en pixeles del original) sirve para dejar fuera lo
// que no es el logo. Si la imagen no queda cuadrada, se centra sobre un lienzo
// cuadrado transparente en vez de deformarla: un logo estirado se nota.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// 256 es el que se ve en el instalador y en el escritorio; 16 el de la barra de
// tareas y el explorador. Los de en medio los elige Windows segun el zoom.
const TAMANOS = [16, 24, 32, 48, 64, 128, 256];

const origen = process.argv.slice(2).find((a) => !a.startsWith('--') && /\.(png|jpe?g|webp|bmp)$/i.test(a));
const sinFondo = process.argv.includes('--sin-fondo');
const leerRecorte = (bandera) => {
  const i = process.argv.indexOf(bandera);
  if (i === -1 || !process.argv[i + 1]) return null;
  const n = process.argv[i + 1].split(',').map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) {
    console.error(bandera + ' quiere cuatro numeros: x,y,ancho,alto');
    process.exit(1);
  }
  return n;
};

const recorte = leerRecorte('--recorte');
const recorteChico = leerRecorte('--recorte-chico');

// Por debajo de este lado se usa el recorte chico, si se dio uno.
const LIMITE_CHICO = 48;

const DESTINO = path.join(__dirname, '..', 'build', 'icon.ico');

// Un .ico es una cabecera, una entrada por tamano y los PNG pegados detras.
// Windows acepta PNG dentro del .ico desde Vista; asi el de 256 no ocupa 256 KB.
function empaquetarIco(pngs) {
  const cabecera = Buffer.alloc(6);
  cabecera.writeUInt16LE(0, 0);            // reservado
  cabecera.writeUInt16LE(1, 2);            // 1 = icono
  cabecera.writeUInt16LE(pngs.length, 4);

  const entradas = [];
  let offset = 6 + pngs.length * 16;

  for (const { lado, datos } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(lado >= 256 ? 0 : lado, 0); // 0 quiere decir 256
    e.writeUInt8(lado >= 256 ? 0 : lado, 1);
    e.writeUInt8(0, 2);                      // colores de la paleta: ninguna
    e.writeUInt8(0, 3);                      // reservado
    e.writeUInt16LE(1, 4);                   // planos
    e.writeUInt16LE(32, 6);                  // bits por pixel
    e.writeUInt32LE(datos.length, 8);
    e.writeUInt32LE(offset, 12);
    entradas.push(e);
    offset += datos.length;
  }

  return Buffer.concat([cabecera, ...entradas, ...pngs.map((p) => p.datos)]);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  if (!origen || !fs.existsSync(origen)) {
    console.error('Falta la imagen de origen. Uso: npm run icono -- "ruta/al/logo.png"');
    app.exit(1);
    return;
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, webSecurity: false },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="margin:0"></body>'));

  const urlImagen = 'file:///' + encodeURI(path.resolve(origen).replace(/\\/g, '/')).replace(/#/g, '%23');

  const resultado = await win.webContents.executeJavaScript(`
    const SIN_FONDO = ${JSON.stringify(sinFondo)};
    new Promise((res, rej) => {
      const img = new Image();
      img.onerror = () => rej(new Error('no se pudo abrir la imagen'));
      img.onload = () => {
        const r = ${JSON.stringify(recorte)};
        const sx = r ? r[0] : 0, sy = r ? r[1] : 0;
        const sw = r ? r[2] : img.naturalWidth, sh = r ? r[3] : img.naturalHeight;
        const lado = Math.max(sw, sh);

        // El logo trae su propio fondo pintado. Si el lienzo cuadrado se deja
        // transparente, el icono sale con dos franjas vacias arriba y abajo y
        // se ve partido. Se miran las cuatro esquinas del original y, si son
        // del mismo color, se rellena con el: el cuadrado parece parte del logo.
        const lee = (x, y) => {
          const u = document.createElement('canvas');
          u.width = u.height = 1;
          const uctx = u.getContext('2d');
          uctx.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
          return uctx.getImageData(0, 0, 1, 1).data;
        };
        const esquinas = [lee(0, 0), lee(img.naturalWidth - 1, 0), lee(0, img.naturalHeight - 1), lee(img.naturalWidth - 1, img.naturalHeight - 1)];
        const iguales = esquinas.every((e) => e[3] > 200
          && Math.abs(e[0] - esquinas[0][0]) < 12
          && Math.abs(e[1] - esquinas[0][1]) < 12
          && Math.abs(e[2] - esquinas[0][2]) < 12);
        const fondo = (SIN_FONDO || !iguales)
          ? null
          : 'rgb(' + esquinas[0][0] + ',' + esquinas[0][1] + ',' + esquinas[0][2] + ')';

        // Lienzo cuadrado con el recorte centrado: ni estirado ni descolocado.
        const base = document.createElement('canvas');
        base.width = lado; base.height = lado;
        const bctx = base.getContext('2d');
        if (fondo) { bctx.fillStyle = fondo; bctx.fillRect(0, 0, lado, lado); }
        bctx.drawImage(img, sx, sy, sw, sh, (lado - sw) / 2, (lado - sh) / 2, sw, sh);

        // Un logo con mucho detalle se vuelve papilla por debajo de 64 px. Si
        // se da un recorte chico -- normalmente solo la parte que se lee, el
        // "DR" --, los tamanos pequenos salen de ahi. Es lo que hacen los
        // juegos de iconos del sistema: la marca completa en grande, lo
        // legible en la barra de tareas.
        const rc = ${JSON.stringify(recorteChico)};
        let baseChico = base;
        if (rc) {
          const ladoC = Math.max(rc[2], rc[3]);
          baseChico = document.createElement('canvas');
          baseChico.width = ladoC; baseChico.height = ladoC;
          const cctx = baseChico.getContext('2d');
          if (fondo) { cctx.fillStyle = fondo; cctx.fillRect(0, 0, ladoC, ladoC); }
          cctx.drawImage(img, rc[0], rc[1], rc[2], rc[3], (ladoC - rc[2]) / 2, (ladoC - rc[3]) / 2, rc[2], rc[3]);
        }

        const salidas = ${JSON.stringify(TAMANOS)}.map((n) => {
          const c = document.createElement('canvas');
          c.width = n; c.height = n;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(n <= ${LIMITE_CHICO} ? baseChico : base, 0, 0, n, n);
          return { lado: n, dataUrl: c.toDataURL('image/png'), chico: n <= ${LIMITE_CHICO} && !!rc };
        });

        res({ ancho: img.naturalWidth, alto: img.naturalHeight, fondo, salidas });
      };
      img.src = ${JSON.stringify(urlImagen)};
    })`);

  const pngs = resultado.salidas.map((s) => ({
    lado: s.lado,
    datos: Buffer.from(s.dataUrl.split(',')[1], 'base64'),
  }));

  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, empaquetarIco(pngs));

  console.log('origen: ' + origen + '  (' + resultado.ancho + 'x' + resultado.alto + ')');
  if (recorte) console.log('recorte: ' + recorte.join(','));
  console.log('fondo del cuadrado: ' + (resultado.fondo || 'transparente'));
  console.log('tamanos: ' + resultado.salidas.map((s) => s.lado + (s.chico ? '*' : '')).join(', ')
    + (recorteChico ? '   (* = del recorte chico ' + recorteChico.join(',') + ')' : ''));
  console.log('escrito: ' + DESTINO + '  (' + fs.statSync(DESTINO).size + ' bytes)');

  win.destroy();
  app.exit(0);
}).catch((e) => {
  console.error('FALLO: ' + e.message);
  app.exit(1);
});
