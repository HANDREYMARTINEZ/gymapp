// Recordatorios de vencimiento por correo.
//
// No manda nada a nadie: se sustituye el transporte de nodemailer por uno de
// mentira que apunta a quien se le habria escrito. Lo que se prueba es la
// decision -- a quien, cuando, y sobre todo a quien NO -- que es donde estan los
// errores que se pagan caros: escribirle dos veces a la misma persona, o
// escribirle a alguien que ya renovo.

const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { format, addDays } = require('date-fns');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-recordatorios-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-recordatorios-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

const handlers = {};
const registrarOriginal = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (canal, fn) => { handlers[canal] = fn; registrarOriginal(canal, fn); };

const PASSPHRASE = 'passphrase-de-prueba';
const dia = (n) => format(addDays(new Date(), n), 'yyyy-MM-dd');

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const conn = require('../electron/db/connection');
    conn.conectar();
    const db = conn.getDb();

    require('../electron/ipc/setup');
    require('../electron/ipc/auth');
    require('../electron/ipc/recordatorios');

    const usuarios = require('../electron/db/repos/usuarios');
    const planes = require('../electron/db/repos/planes');
    const clientes = require('../electron/db/repos/clientes');
    const membresias = require('../electron/db/repos/membresias');
    const correo = require('../electron/services/correo');
    const recordatorios = require('../electron/services/recordatorios');

    // ---- El transporte de mentira ---------------------------------------
    // Sustituye a nodemailer. Guarda a quien se escribio y puede fallar a la
    // orden, para poder probar que un correo malo no tumba la ronda entera.
    const enviados = [];
    let rebotaA = null;
    correo.crearTransporte = () => ({
      sendMail: async (mensaje) => {
        if (rebotaA && mensaje.to === rebotaA) throw new Error('Invalid login: 535 rechazado');
        enviados.push(mensaje);
        return { accepted: [mensaje.to] };
      },
      close: () => {},
      verify: async () => true,
    });

    const admin = await usuarios.crear({ nombre: 'Andrey', usuario: 'andrey', password: 'clave1234', rol: 'admin' });
    await handlers['setup:finalizar'](null, PASSPHRASE);
    await handlers['auth:vincularPassphrase'](null,
      { usuario: 'andrey', password: 'clave1234', passphrase: PASSPHRASE });
    db.prepare("INSERT INTO config (clave, valor) VALUES ('gym_nombre', 'Gimnasio Central') ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run();

    // Con la caja cerrada los pagos no entran, la membresia queda con saldo y su
    // estado pasa a ser 'saldo_pendiente' en vez de 'vencida'. Ahi se vio que un
    // cliente que debe dinero no recibe recordatorio: es a proposito, su estado
    // no es "vencida". Aqui se abre caja para probar el caso normal.
    require('../electron/db/repos/caja').abrir({ usuarioId: admin.id, baseInicial: 0 });

    const mensual = planes.crear({ nombre: 'Mensual', tipo: 'periodo', precio: 100000, dias_duracion: 30 });

    // Cuatro situaciones distintas, que son las cuatro respuestas posibles.
    const vencido = clientes.crear({ documento: '1', nombre: 'Vencido Con Correo', email: 'vencido@ejemplo.com' });
    const porVencer = clientes.crear({ documento: '2', nombre: 'Por Vencer', email: 'porvencer@ejemplo.com' });
    const alDia = clientes.crear({ documento: '3', nombre: 'Al Dia', email: 'aldia@ejemplo.com' });
    const sinCorreo = clientes.crear({ documento: '4', nombre: 'Vencido Sin Correo', telefono: '3001112233' });
    // Los tres correos que existen pero no sirven. Salieron de los datos reales
    // del gimnasio: el Excel traia direcciones generadas @example.com, muchas con
    // tildes. Mandarles la ronda serian sesenta rebotes seguidos.
    const deEjemplo = clientes.crear({ documento: '5', nombre: 'Correo De Ejemplo', email: 'alguien@example.com' });
    const conTilde = clientes.crear({ documento: '6', nombre: 'Correo Con Tilde', email: 'josé.pérez@gmail.com' });
    const malEscrito = clientes.crear({ documento: '7', nombre: 'Correo Mal Escrito', email: 'esto-no-es-un-correo' });

    const vender = (clienteId, fFin) => {
      const id = membresias.vender({ clienteId, planId: mensual, usuarioId: admin.id });
      membresias.registrarPago({ membresiaId: id, monto: 100000, metodo: 'Efectivo', usuarioId: admin.id });
      db.prepare('UPDATE membresias SET f_fin = ? WHERE id = ?').run(fFin, id);
      return id;
    };

    vender(vencido, dia(-10));
    vender(porVencer, dia(3));
    vender(alDia, dia(25));
    vender(sinCorreo, dia(-5));
    vender(deEjemplo, dia(-6));
    vender(conTilde, dia(-7));
    vender(malEscrito, dia(-8));

    // ---- A quien le toca -------------------------------------------------
    let lista = recordatorios.destinatarios({ incluyePorVencer: true, cadaDias: 15 });
    const nombres = lista.porEnviar.map(d => d.nombre).sort();
    check('entra el vencido y el que esta por vencer',
          nombres.join(' | ') === 'Por Vencer | Vencido Con Correo', nombres.join(' | '));
    check('el que esta al dia NO recibe nada',
          !lista.porEnviar.some(d => d.nombre === 'Al Dia'));
    check('el vencido sin correo sale aparte, para llamarlo',
          lista.sinCorreo.length === 1 && lista.sinCorreo[0].telefono === '3001112233');
    check('cada uno con su tipo',
          lista.porEnviar.find(d => d.nombre === 'Vencido Con Correo').tipo === 'vencida' &&
          lista.porEnviar.find(d => d.nombre === 'Por Vencer').tipo === 'por_vencer');

    check('un correo @example.com no recibe nada: ese dominio no existe',
          lista.correoInvalido.some(d => d.problema === 'dominio_de_ejemplo'));
    check('uno con tildes tampoco: el SMTP de siempre no las acepta',
          lista.correoInvalido.some(d => d.problema === 'con_tildes'));
    check('ni uno que no tiene forma de correo',
          lista.correoInvalido.some(d => d.problema === 'mal_escrito'));
    check('y ninguno de los tres se cuela en los que si se envian',
          !lista.porEnviar.some(d => ['Correo De Ejemplo', 'Correo Con Tilde', 'Correo Mal Escrito'].includes(d.nombre)));

    lista = recordatorios.destinatarios({ incluyePorVencer: false, cadaDias: 15 });
    check('si se apagan los "por vencer", solo quedan los vencidos',
          lista.porEnviar.length === 1 && lista.porEnviar[0].tipo === 'vencida');

    // ---- La coletilla de la baja, fuera ----------------------------------
    check('las plantillas por defecto ya no llevan la frase de la baja',
          !recordatorios.DEFECTOS.recordatorios_cuerpo_vencida.includes('BAJA') &&
          !recordatorios.DEFECTOS.recordatorios_cuerpo_por_vencer.includes('BAJA'));

    // Y a una instalacion que ya la tenia guardada se la quita la migracion 007.
    // Se reproduce aqui el texto viejo tal cual estaba en la base de Andrey.
    const NL2 = String.fromCharCode(10);
    const viejo = 'Hola {nombre},' + NL2 + NL2 + 'Tu membresía venció.' + NL2 + NL2 +
                  '{gimnasio}' + NL2 + NL2 + '---' + NL2 +
                  'Si no quieres recibir estos recordatorios, responde a este correo con la palabra BAJA.';
    correo.setConfig('recordatorios_cuerpo_vencida', viejo);
    const sql = fs.readFileSync(path.join(__dirname, '..', 'electron', 'db', 'migrations', '007_quitar_linea_baja.sql'), 'utf-8');
    db.exec(sql);
    const limpio = recordatorios.leerConfig().plantillas.vencida.cuerpo;
    check('la migracion 007 se la quita a una plantilla ya guardada',
          !limpio.includes('BAJA') && !limpio.includes('---'), JSON.stringify(limpio.slice(-40)));
    check('y no se lleva por delante el resto del mensaje',
          limpio.includes('Tu membresía venció.') && limpio.endsWith('{gimnasio}'));

    // Una plantilla personalizada que lleve una raya por otro motivo no se toca.
    const conRaya = 'Hola,' + NL2 + NL2 + '---' + NL2 + 'Horario: 6am a 10pm';
    correo.setConfig('recordatorios_cuerpo_por_vencer', conRaya);
    db.exec(sql);
    check('una raya escrita a proposito, sin la frase de la baja, se respeta',
          recordatorios.leerConfig().plantillas.por_vencer.cuerpo === conRaya);

    correo.setConfig('recordatorios_cuerpo_vencida', recordatorios.DEFECTOS.recordatorios_cuerpo_vencida);
    correo.setConfig('recordatorios_cuerpo_por_vencer', recordatorios.DEFECTOS.recordatorios_cuerpo_por_vencer);

    // ---- El color del correo sigue a la paleta de la app -------------------
    check('el color por defecto ya es el amarillo de la marca',
          recordatorios.DEFECTOS.recordatorios_color === '#ffe500',
          recordatorios.DEFECTOS.recordatorios_color);

    // Y a quien ya lo tuviera guardado se lo cambia la migracion 008.
    const sqlColor = fs.readFileSync(
      path.join(__dirname, '..', 'electron', 'db', 'migrations', '008_color_correo_amarillo.sql'), 'utf-8');
    correo.setConfig('recordatorios_color', '#3b5bdb');
    db.exec(sqlColor);
    check('la migracion 008 cambia el azul viejo por el amarillo',
          recordatorios.leerConfig().color === '#ffe500', recordatorios.leerConfig().color);

    const aMano = '#00aa55';
    correo.setConfig('recordatorios_color', aMano);
    db.exec(sqlColor);
    check('un color elegido a mano no se pisa',
          recordatorios.leerConfig().color === aMano, recordatorios.leerConfig().color);

    correo.setConfig('recordatorios_color', recordatorios.DEFECTOS.recordatorios_color);
    const { construirHtml } = require('../electron/services/plantillaCorreo');
    check('y el HTML del correo sale pintado con el color guardado',
          construirHtml({ cuerpo: 'Hola', gimnasio: 'Gym', color: recordatorios.leerConfig().color })
            .includes('#ffe500'));

    // ---- Activar no puede disparar la primera ronda a traicion -----------
    check('recien instalado no hay ninguna ronda anotada',
          recordatorios.leerConfig().ultimaRonda === null);
    recordatorios.guardarConfig({ activo: true });
    check('al activar por primera vez, la cuenta arranca hoy',
          recordatorios.leerConfig().ultimaRonda === format(new Date(), 'yyyy-MM-dd'));
    check('asi que el vigilante NO manda nada nada mas activarlo',
          recordatorios.tocaRonda(recordatorios.leerConfig()) === false);
    recordatorios.guardarConfig({ activo: false });
    correo.setConfig('recordatorios_ultima_ronda', '');

    // ---- Sin configurar no manda nada ------------------------------------
    const sinNada = await recordatorios.enviarRonda({ manual: true });
    check('sin remitente configurado no se manda nada',
          sinNada.ok === false && sinNada.motivo === 'sin_remitente', sinNada.motivo);

    recordatorios.guardarConfig({ activo: true, cadaDias: 15, incluyePorVencer: true,
                                  remitente: 'gimnasio@ejemplo.com', nombreRemitente: 'Gimnasio Central' });
    const sinClave = await recordatorios.enviarRonda({ manual: true });
    check('sin contrasena de aplicacion tampoco',
          sinClave.ok === false && sinClave.motivo === 'sin_password', sinClave.motivo);

    // ---- La contrasena se guarda cifrada ---------------------------------
    correo.guardarPassword('abcd efgh ijkl mnop');
    const guardada = db.prepare("SELECT valor FROM config WHERE clave = ?").get(correo.CLAVE_PASS).valor;
    check('la contrasena del correo no queda en claro en la base',
          !guardada.includes('abcd') && !guardada.includes('abcdefghijklmnop'), guardada.slice(0, 24));
    check('pero se puede volver a leer con la base abierta',
          correo.leerPassword() === 'abcdefghijklmnop', correo.leerPassword());

    const { guardarDekEnMemoria, obtenerDekEnMemoria } = require('../electron/crypto/dek');
    const dek = obtenerDekEnMemoria();
    guardarDekEnMemoria(null);
    check('con la base cerrada no hay forma de leerla', correo.leerPassword() === null);
    guardarDekEnMemoria(dek);

    // ---- La ronda --------------------------------------------------------
    const ronda = await recordatorios.enviarRonda({ manual: true });
    check('la ronda sale', ronda.ok === true, ronda.motivo);
    check('se escribieron dos correos', ronda.enviados === 2, 'enviados=' + ronda.enviados);
    check('y cuenta al que no tiene correo', ronda.sinCorreo === 1);
    check('cada correo va a una sola persona, no en copia oculta',
          enviados.every(m => !m.bcc && !String(m.to).includes(',')));
    check('el asunto y el cuerpo llevan el nombre de quien lo recibe',
          enviados.some(m => m.text.includes('Vencido Con Correo')) &&
          enviados.some(m => m.text.includes('Por Vencer')));
    check('y el nombre del gimnasio, no un marcador sin rellenar',
          enviados.every(m => m.text.includes('Gimnasio Central') && !m.text.includes('{')));
    check('el remitente sale con nombre visible',
          enviados.every(m => m.from.includes('Gimnasio Central') && m.from.includes('gimnasio@ejemplo.com')));

    // ---- Lo que de verdad importa: no repetir -----------------------------
    const segunda = await recordatorios.enviarRonda({ manual: true });
    check('lanzar la ronda otra vez el mismo dia no le escribe a nadie',
          segunda.enviados === 0, 'enviados=' + segunda.enviados);
    check('porque los reconoce como ya avisados', segunda.yaAvisados === 2);
    check('y no se mandaron mas correos que los dos primeros', enviados.length === 2);

    // Pasado el periodo si vuelve a tocar: se envejecen los registros a mano.
    db.prepare("UPDATE recordatorios_enviados SET fecha = ?").run(new Date(Date.now() - 20 * 86400000).toISOString());
    const tercera = await recordatorios.enviarRonda({ manual: true });
    check('pasados los 15 dias vuelve a avisar', tercera.enviados === 2, 'enviados=' + tercera.enviados);

    // ---- Un correo que rebota no tumba la ronda ---------------------------
    db.prepare("UPDATE recordatorios_enviados SET fecha = ?").run(new Date(Date.now() - 20 * 86400000).toISOString());
    rebotaA = 'vencido@ejemplo.com';
    const conFallo = await recordatorios.enviarRonda({ manual: true });
    check('si un correo falla, el resto se envia igual',
          conFallo.enviados === 1 && conFallo.fallidos === 1,
          'enviados=' + conFallo.enviados + ' fallidos=' + conFallo.fallidos);
    check('el fallo queda anotado con un motivo entendible',
          conFallo.errores.length === 1 && conFallo.errores[0].motivo.includes('contraseña de aplicación'),
          conFallo.errores[0] && conFallo.errores[0].motivo);
    check('y en el historial se ve cual fallo',
          recordatorios.historial(10).some(h => h.ok === 0 && h.email === 'vencido@ejemplo.com'));
    rebotaA = null;

    // ---- El calendario ----------------------------------------------------
    let config = recordatorios.leerConfig();
    check('la ronda queda fechada hoy', config.ultimaRonda === format(new Date(), 'yyyy-MM-dd'));
    check('y hasta que pasen 15 dias no vuelve a tocar', recordatorios.tocaRonda(config) === false);

    correo.setConfig('recordatorios_ultima_ronda', dia(-15));
    config = recordatorios.leerConfig();
    check('a los 15 dias vuelve a tocar', recordatorios.tocaRonda(config) === true);

    // Un PC apagado el dia que tocaba no pierde la ronda: se mira cuantos dias
    // han pasado, no si hoy es el dia exacto.
    correo.setConfig('recordatorios_ultima_ronda', dia(-40));
    check('y si el PC estuvo apagado varios dias, sale igual al volver',
          recordatorios.tocaRonda(recordatorios.leerConfig()) === true);

    correo.setConfig('recordatorios_activo', '0');
    check('desactivado no toca nunca, por muchos dias que pasen',
          recordatorios.tocaRonda(recordatorios.leerConfig()) === false);

    // ---- El vigilante no manda nada con la base cerrada -------------------
    correo.setConfig('recordatorios_activo', '1');
    db.prepare("UPDATE recordatorios_enviados SET fecha = ?").run(new Date(Date.now() - 40 * 86400000).toISOString());
    const antes = enviados.length;
    guardarDekEnMemoria(null);
    await recordatorios.revisar();
    check('con nadie dentro de la app, el vigilante no manda nada',
          enviados.length === antes, 'se mandaron ' + (enviados.length - antes));
    guardarDekEnMemoria(dek);

    // ---- El correo con diseno -------------------------------------------
    // Un correo HTML sin su version en texto plano es medio correo: es lo que ve
    // quien lo tiene en modo texto, y lo que leen los filtros de spam.
    const ultimoDeLaRonda = enviados[enviados.length - 1];
    check('el correo lleva version HTML', !!ultimoDeLaRonda.html);
    check('y SIEMPRE tambien la de texto plano', !!ultimoDeLaRonda.text);
    check('el HTML lleva el nombre del gimnasio', ultimoDeLaRonda.html.includes('Gimnasio Central'));
    // El HTML y el texto tienen que decir lo mismo. Se compara contra el propio
    // texto del mensaje y no contra una frase fija: el ultimo de la ronda puede
    // ser un vencido o un "por vencer", y cada uno lleva su plantilla.
    const primerParrafo = ultimoDeLaRonda.text.split(String.fromCharCode(10))[0];
    check('y dice lo mismo que la version de texto',
          ultimoDeLaRonda.html.includes(primerParrafo), primerParrafo);
    check('maquetado con tablas, que es lo unico que respetan Gmail y Outlook',
          ultimoDeLaRonda.html.includes('<table') && !ultimoDeLaRonda.html.includes('display:flex'));

    // Un nombre con un caracter de HTML no puede romper el correo ni colar
    // etiquetas: el texto de las plantillas y los nombres los escribe una persona.
    const conMarcado = recordatorios.componerMensaje({
      destino: { nombre: '<script>alert(1)</script> & Cia', plan: 'Mensual', fFin: dia(-2), dias: 2, tipo: 'vencida' },
      config: recordatorios.leerConfig(),
      gimnasio: { nombre: 'Gym & Co', direccion: '', telefono: '' },
      logo: null,
    });
    check('un nombre con etiquetas HTML se escapa, no se ejecuta',
          !conMarcado.html.includes('<script>') && conMarcado.html.includes('&lt;script&gt;'));
    check('y un & del nombre del gimnasio tampoco rompe nada',
          conMarcado.html.includes('Gym &amp; Co'));

    // Sin logo subido, el correo sale igual: solo que sin imagen.
    check('sin logo no se adjunta nada', conMarcado.adjuntos.length === 0);
    check('y no queda ningun <img> apuntando al vacio', !conMarcado.html.includes('<img'));

    const conLogo = recordatorios.componerMensaje({
      destino: { nombre: 'Quien Sea', plan: 'Mensual', fFin: dia(-2), dias: 2, tipo: 'vencida' },
      config: recordatorios.leerConfig(),
      gimnasio: { nombre: 'Gimnasio Central', direccion: 'Calle 10', telefono: '3001234567' },
      logo: { mime: 'image/png', buffer: Buffer.from('89504e47', 'hex'), dataUrl: 'data:image/png;base64,iVBOR' },
    });
    check('con logo, va incrustado como adjunto y no enlazado a internet',
          conLogo.adjuntos.length === 1 && conLogo.adjuntos[0].cid === 'logo-gimnasio' &&
          conLogo.html.includes('cid:logo-gimnasio') && !conLogo.html.includes('http'));
    check('y la direccion y el telefono del gimnasio salen en el pie',
          conLogo.html.includes('Calle 10') && conLogo.html.includes('3001234567'));

    // Apagar el diseno tiene que devolver el correo de texto de siempre.
    recordatorios.guardarConfig({ html: false });
    const soloTexto = recordatorios.componerMensaje({
      destino: { nombre: 'Quien Sea', plan: 'Mensual', fFin: dia(-2), dias: 2, tipo: 'vencida' },
      config: recordatorios.leerConfig(),
      gimnasio: { nombre: 'Gimnasio Central', direccion: '', telefono: '' },
      logo: null,
    });
    check('con el diseno apagado, el correo vuelve a ser solo texto',
          soloTexto.html === null && !!soloTexto.texto);
    recordatorios.guardarConfig({ html: true });

    // La vista previa de la pantalla usa el mismo codigo que el envio, o no
    // valdria para nada.
    const vista = recordatorios.vistaPrevia('por_vencer');
    check('la vista previa devuelve el correo montado',
          vista.ok === true && vista.html.includes('<table') && !!vista.asunto);
    check('y la del tipo que se le pide', vista.asunto.includes('por vencer'), vista.asunto);

    // ---- El correo de prueba se lo manda uno a si mismo -------------------
    const prueba = await recordatorios.enviarPrueba();
    check('la prueba se envia', prueba.ok === true, prueba.motivo);
    const cuerpoPrueba = enviados[enviados.length - 1].text;
    check('la fecha del correo de prueba cuadra con los dias que dice',
          cuerpoPrueba.includes('hace 3 días') &&
          !cuerpoPrueba.includes(format(new Date(), 'yyyy-MM-dd')),
          cuerpoPrueba.split(String.fromCharCode(10))[2]);
    check('y va al propio remitente, nunca a un cliente',
          enviados[enviados.length - 1].to === 'gimnasio@ejemplo.com');
    check('marcada como prueba en el asunto',
          enviados[enviados.length - 1].subject.startsWith('[PRUEBA]'));

    db.close();
  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallos === 0 ? 0 : 1);
});
