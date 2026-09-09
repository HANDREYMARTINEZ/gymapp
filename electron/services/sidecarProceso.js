const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');

// Arranca y vigila el sidecar del lector de huella.
//
// Hasta ahora el sidecar habia que abrirlo a mano desde Visual Studio, y eso
// arrastraba los tres pendientes que quedaban de F5:
//
//   - Su ventana tenia que estar a la vista, encima de la app.
//   - Robaba el foco, y habia que devolverselo al kiosco con un clic.
//   - El token compartido era el texto de ejemplo "CAMBIA-ESTE-TOKEN", igual en
//     todas las instalaciones.
//
// Lanzandolo desde aqui los tres se caen solos: el proceso nace oculto, no se
// activa nunca, y recibe por linea de comandos un token distinto en cada
// gimnasio, generado la primera vez y guardado en la base.

const CLAVE_TOKEN = 'sidecar_token';
const NOMBRE_EXE = 'SidecarHuella.exe';

let proceso = null;

function getConfig(clave) {
  const row = getDb().prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  return row ? row.valor : null;
}

// El token se genera una vez por instalacion. No es un secreto que proteja gran
// cosa -- el sidecar solo escucha en 127.0.0.1 -- pero evita que cualquier otro
// programa del PC le hable al lector, y sobre todo evita que el mismo texto de
// ejemplo sirva en todos los gimnasios.
function token() {
  let guardado = getConfig(CLAVE_TOKEN);
  if (!guardado) {
    guardado = crypto.randomBytes(24).toString('hex');
    getDb().prepare(
      `INSERT INTO config (clave, valor) VALUES (?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
    ).run(CLAVE_TOKEN, guardado);
  }
  return guardado;
}

// En la app instalada el sidecar va como extraResource, al lado del ejecutable.
// En desarrollo se coge lo que haya compilado Visual Studio.
function rutaExe() {
  const candidatas = [];
  if (process.resourcesPath) {
    candidatas.push(path.join(process.resourcesPath, 'sidecar', NOMBRE_EXE));
  }
  candidatas.push(path.join(__dirname, '..', '..', 'sidecar-huella', 'bin', 'Release', NOMBRE_EXE));
  candidatas.push(path.join(__dirname, '..', '..', 'sidecar-huella', 'bin', 'Debug', NOMBRE_EXE));
  return candidatas.find(r => fs.existsSync(r)) || null;
}

function estaVivo() {
  return !!proceso && proceso.exitCode === null && !proceso.killed;
}

// Devuelve { ok } o { ok:false, motivo }. Nunca lanza: que no haya lector
// conectado es lo normal en un PC de pruebas, y no puede tumbar el arranque.
function asegurarEncendido() {
  if (estaVivo()) return { ok: true, yaEstaba: true };

  const exe = rutaExe();
  if (!exe) return { ok: false, motivo: 'sidecar_no_instalado' };

  try {
    // GYMAPP_SIDECAR_VISIBLE=1 deja la ventana del sidecar a la vista, como el
    // ejemplo original de DigitalPersona. Es para diagnosticar: si con la ventana
    // visible el lector si entrega muestras y oculta no, ya sabemos donde mirar.
    const argumentos = [token()];
    if (process.env.GYMAPP_SIDECAR_VISIBLE === '1') argumentos.push('visible');

    proceso = spawn(exe, argumentos, {
      // windowsHide evita el parpadeo de consola; que la ventana del propio
      // sidecar no se vea lo decide el, con el argumento que recibe.
      windowsHide: true,
      stdio: 'ignore',
      detached: false,
      cwd: path.dirname(exe),
    });
    proceso.on('exit', () => { proceso = null; });
    proceso.on('error', () => { proceso = null; });
    return { ok: true, ruta: exe };
  } catch (e) {
    proceso = null;
    return { ok: false, motivo: 'no_se_pudo_lanzar', detalle: e.message };
  }
}

// Al cerrar la app se cierra tambien. Si no, cada arranque dejaria otro sidecar
// vivo peleando por el puerto 8383 con el anterior.
function apagar() {
  if (proceso) {
    try { proceso.kill(); } catch (e) { /* ya estaba muerto */ }
    proceso = null;
  }
}

module.exports = { asegurarEncendido, apagar, estaVivo, token, rutaExe, CLAVE_TOKEN };
