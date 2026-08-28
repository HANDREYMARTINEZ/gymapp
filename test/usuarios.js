const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NL = String.fromCharCode(10);
const SALIDA = path.join(os.tmpdir(), 'gymapp-test-usuarios-resultado.txt');
const lineas = [];
const log = (t) => { lineas.push(t); };
const volcar = () => { try { fs.writeFileSync(SALIDA, lineas.join(NL), 'utf-8'); } catch (e) {} };

const testDir = path.join(os.tmpdir(), 'gymapp-test-usuarios-' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
app.setPath('userData', testDir);

app.whenReady().then(async () => {
  let fallos = 0;
  const check = (nombre, cond, extra) => {
    log((cond ? 'PASS  ' : 'FALLA ') + nombre + (extra ? ' -> ' + extra : ''));
    if (!cond) fallos++;
  };

  try {
    const conn = require('../electron/db/connection');
    conn.conectar();
    const repo = require('../electron/db/repos/usuarios');
    const argon2 = require('argon2');

    // El admin que crea el wizard de setup.
    const admin = await repo.crear({ nombre: 'Ana Admin', usuario: 'ana', password: 'clave1234', rol: 'admin' });
    check('crear admin devuelve ok', admin.ok && admin.id > 0, 'id=' + admin.id);

    // --- validaciones ---
    check('rechaza nombre vacio',
          (await repo.crear({ nombre: '  ', usuario: 'x1', password: 'abcd', rol: 'admin' })).motivo === 'nombre_requerido');
    check('rechaza rol inventado',
          (await repo.crear({ nombre: 'X', usuario: 'x2', password: 'abcd', rol: 'dueno' })).motivo === 'rol_invalido');
    check('rechaza usuario muy corto',
          (await repo.crear({ nombre: 'X', usuario: 'ab', password: 'abcd', rol: 'admin' })).motivo === 'usuario_muy_corto');
    check('rechaza password muy corta',
          (await repo.crear({ nombre: 'X', usuario: 'xyz', password: '12', rol: 'admin' })).motivo === 'password_muy_corta');

    const dup = await repo.crear({ nombre: 'Otra Ana', usuario: 'ANA', password: 'clave1234', rol: 'asistente' });
    check('el usuario duplicado se rechaza sin importar mayusculas',
          !dup.ok && dup.motivo === 'usuario_ya_existe', 'motivo=' + dup.motivo);

    // --- el hash nunca sale del repo ---
    const leido = repo.obtenerPorId(admin.id);
    check('obtenerPorId no devuelve el hash', leido.hash_pass === undefined);
    check('listar tampoco devuelve el hash', repo.listar().every(u => u.hash_pass === undefined));
    check('el usuario se guardo en minusculas', leido.usuario === 'ana');

    // --- la contrasena si funciona de verdad ---
    const fila = conn.getDb().prepare(`SELECT hash_pass FROM usuarios WHERE id = ?`).get(admin.id);
    check('la password quedo hasheada, no en claro', fila.hash_pass !== 'clave1234');
    check('la password original verifica', await argon2.verify(fila.hash_pass, 'clave1234'));

    // --- asistente ---
    const asis = await repo.crear({ nombre: 'Beto Asistente', usuario: 'beto', password: 'beto1234', rol: 'asistente' });
    check('crear asistente devuelve ok', asis.ok);
    check('listar trae los dos', repo.listar().length === 2);

    // --- el candado del ultimo admin ---
    check('hay un solo admin activo', repo.contarAdminsActivos() === 1);

    const bajar = repo.editar(admin.id, { nombre: 'Ana Admin', rol: 'asistente' });
    check('NO deja bajar de rol al ultimo admin',
          !bajar.ok && bajar.motivo === 'ultimo_admin', 'motivo=' + bajar.motivo);
    check('el rol no cambio tras el rechazo', repo.obtenerPorId(admin.id).rol === 'admin');

    const apagar = repo.desactivar(admin.id);
    check('NO deja desactivar al ultimo admin',
          !apagar.ok && apagar.motivo === 'ultimo_admin', 'motivo=' + apagar.motivo);
    check('sigue activo tras el rechazo', repo.obtenerPorId(admin.id).activo === 1);

    // --- con un segundo admin, el candado se suelta ---
    const admin2 = await repo.crear({ nombre: 'Caro Admin', usuario: 'caro', password: 'caro1234', rol: 'admin' });
    check('segundo admin creado', admin2.ok);
    check('ahora hay dos admins activos', repo.contarAdminsActivos() === 2);

    const bajar2 = repo.editar(admin.id, { nombre: 'Ana Admin', rol: 'asistente' });
    check('ya SI deja bajar al primero', bajar2.ok, 'motivo=' + bajar2.motivo);
    check('quedo como asistente', repo.obtenerPorId(admin.id).rol === 'asistente');
    check('vuelve a haber un solo admin activo', repo.contarAdminsActivos() === 1);

    // --- y el candado vuelve a cerrarse sobre el que queda ---
    const apagar2 = repo.desactivar(admin2.id);
    check('no deja desactivar al admin que quedo solo',
          !apagar2.ok && apagar2.motivo === 'ultimo_admin', 'motivo=' + apagar2.motivo);

    // --- desactivar a un asistente si se puede ---
    const apagarAsis = repo.desactivar(asis.id);
    check('desactivar a un asistente si se puede', apagarAsis.ok);
    check('quedo inactivo', repo.obtenerPorId(asis.id).activo === 0);
    check('no se puede desactivar dos veces', repo.desactivar(asis.id).motivo === 'ya_inactivo');
    check('sigue apareciendo en listar (no se borro)', repo.listar().some(u => u.id === asis.id));
    check('reactivar funciona', repo.activar(asis.id).ok && repo.obtenerPorId(asis.id).activo === 1);

    // --- desactivar a un ex-admin ya degradado no dispara el candado ---
    check('desactivar al ex-admin degradado si se puede', repo.desactivar(admin.id).ok);
    check('y el admin que queda sigue en pie', repo.contarAdminsActivos() === 1);

    // --- cambio de contrasena ---
    check('rechaza una password nueva muy corta',
          (await repo.cambiarPassword({ id: admin2.id, password: 'ab' })).motivo === 'password_muy_corta');

    const cambio = await repo.cambiarPassword({ id: admin2.id, password: 'nuevaclave' });
    check('cambiar password devuelve ok', cambio.ok);

    const nuevaFila = conn.getDb().prepare(`SELECT hash_pass FROM usuarios WHERE id = ?`).get(admin2.id);
    check('la password nueva verifica', await argon2.verify(nuevaFila.hash_pass, 'nuevaclave'));
    check('la password vieja ya NO verifica', !(await argon2.verify(nuevaFila.hash_pass, 'caro1234')));

    check('cambiar password de alguien que no existe falla limpio',
          (await repo.cambiarPassword({ id: 9999, password: 'abcd1234' })).motivo === 'no_existe');

    // --- cuentas viejas con mayusculas (las que creaba el wizard antes) ---
    // Se inserta a mano a proposito, saltandose el repo, para reproducir como
    // quedaron guardadas antes de que el setup pasara por el.
    log('--- compatibilidad con cuentas creadas por el wizard antiguo ---');
    const hashViejo = await argon2.hash('vieja1234');
    conn.getDb().prepare(`
      INSERT INTO usuarios (nombre, usuario, hash_pass, rol, activo, creado_en)
      VALUES ('Dora Vieja', 'DoraVieja', ?, 'admin', 1, ?)
    `).run(hashViejo, new Date().toISOString());

    const buscar = (login) => conn.getDb().prepare(
      `SELECT id, usuario FROM usuarios WHERE lower(usuario) = lower(?)`
    ).get(String(login || '').trim());

    check('una cuenta vieja con mayusculas entra escribiendola igual', !!buscar('DoraVieja'));
    check('y tambien escribiendola en minusculas', !!buscar('doravieja'),
          'este era el caso que fallaba');
    check('y tolerando espacios de mas', !!buscar('  DORAVIEJA  '));

    const choque = await repo.crear({ nombre: 'Impostora', usuario: 'doravieja', password: 'otra1234', rol: 'asistente' });
    check('no deja crear un gemelo en minusculas de una cuenta vieja',
          !choque.ok && choque.motivo === 'usuario_ya_existe', 'motivo=' + choque.motivo);
    check('editar a alguien que no existe falla limpio',
          repo.editar(9999, { nombre: 'X', rol: 'admin' }).motivo === 'no_existe');

    conn.getDb().close();
  } catch (e) {
    log('EXCEPCION -> ' + e.stack);
    fallos++;
  }

  log(fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)');
  volcar();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  app.exit(fallos === 0 ? 0 : 1);
});
