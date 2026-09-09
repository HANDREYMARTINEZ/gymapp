// El marco HTML de los correos de recordatorio.
//
// Un correo no es una pagina web. Gmail y Outlook tiran la mitad del CSS, no
// entienden flex ni grid, y Outlook de escritorio sigue maquetando con el motor
// de Word. Por eso esto son tablas anidadas y estilos escritos a mano en cada
// etiqueta, que en 2026 parece de museo y es lo unico que se ve igual en todos
// lados.
//
// El texto que se escribe en Configuracion NO es HTML: sigue siendo texto
// normal, y este archivo lo envuelve. Nadie deberia tener que editar etiquetas
// en un cuadro de texto para cambiar "pasate por recepcion".

const ANCHO = 560;

// Todo lo que venga del usuario o de la base pasa por aqui antes de entrar al
// HTML. El nombre de un cliente con un "&" o un "<" romperia el correo, y el
// texto de la plantilla lo escribe una persona, no el programa.
function escapar(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// El cuerpo llega como texto con saltos de linea. Una linea de guiones marca
// donde empieza la letra pequena -- en las plantillas por defecto, la frase de
// la baja -- y se convierte en una raya de verdad.
function cuerpoAHtml(texto, color) {
  const bloques = String(texto || '').split(/\n{2,}/);
  const piezas = [];
  let enLetraPequena = false;

  for (const bloque of bloques) {
    const limpio = bloque.trim();
    if (!limpio) continue;

    if (/^-{3,}$/.test(limpio)) {
      enLetraPequena = true;
      piezas.push(
        `<tr><td style="padding:8px 32px 0"><div style="border-top:1px solid #e3e6ee;font-size:1px;line-height:1px">&nbsp;</div></td></tr>`
      );
      continue;
    }

    const estilo = enLetraPequena
      ? 'margin:0;padding:10px 32px 0;font-size:12px;line-height:1.5;color:#8a92a6'
      : 'margin:0;padding:0 32px 14px;font-size:15px;line-height:1.6;color:#2b3140';

    piezas.push(
      `<tr><td><p style="${estilo}">${escapar(limpio).replace(/\n/g, '<br />')}</p></td></tr>`
    );
  }

  // Si el texto no trae nada, al menos que no llegue un correo vacio.
  if (piezas.length === 0) {
    piezas.push(`<tr><td><p style="margin:0;padding:0 32px 14px;font-size:15px;color:#2b3140">&nbsp;</p></td></tr>`);
  }
  return piezas.join('');
}

// logoSrc es lo unico que cambia entre mandar y previsualizar: al enviar es
// "cid:logo", que apunta al adjunto incrustado y no depende de que exista un
// servidor donde alojar la imagen; en la vista previa de la app es el data URL
// directamente, porque ahi no hay adjuntos.
function construirHtml({ cuerpo, gimnasio, direccion, telefono, color, logoSrc, titulo }) {
  const acento = /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? color : '#ffe500';
  const nombre = escapar(gimnasio || 'Gimnasio');

  const cabeceraLogo = logoSrc
    // El ancho va tambien como atributo width y no solo en el estilo: Outlook
    // ignora el CSS de las imagenes y se queda con el atributo.
    ? `<tr><td align="center" style="padding:28px 32px 0">
         <img src="${escapar(logoSrc)}" alt="${nombre}" width="150"
              style="display:block;width:150px;max-width:60%;height:auto;border:0;border-radius:16px" />
       </td></tr>`
    : '';

  const pie = [direccion, telefono].filter(Boolean).map(escapar).join(' &middot; ');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapar(titulo || nombre)}</title></head>
<body style="margin:0;padding:0;background:#eef1f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f6">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="${ANCHO}" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:${ANCHO}px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:'Segoe UI',Helvetica,Arial,sans-serif">

      <tr><td style="background:${acento};height:6px;font-size:0;line-height:0">&nbsp;</td></tr>

      ${cabeceraLogo}

      <tr><td align="center" style="padding:18px 32px 4px">
        <div style="font-size:19px;font-weight:700;color:#1a1f2b;letter-spacing:0.2px">${nombre}</div>
      </td></tr>

      <tr><td style="padding:14px 0 6px">
        <div style="height:1px;background:#e8ebf2;font-size:0;line-height:0">&nbsp;</div>
      </td></tr>

      <tr><td style="padding-top:18px">&nbsp;</td></tr>

      ${cuerpoAHtml(cuerpo, acento)}

      <tr><td style="padding:18px 32px 26px">
        <div style="border-top:1px solid #e8ebf2;padding-top:14px;font-size:12px;color:#9aa2b4;text-align:center">
          ${pie || nombre}
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

module.exports = { construirHtml, escapar, ANCHO };
