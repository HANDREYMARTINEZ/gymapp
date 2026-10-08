import { useEffect, useState } from 'react';

// En que monitor sale el kiosco de los clientes (boton "Kiosco en 2.ª
// pantalla" o F2). Con dos monitores no hay nada que pensar; con tres, sin
// elegir, saldria en el primero de izquierda a derecha que no sea el de
// recepcion, que puede no ser el que miran los clientes.
//
// Elegir se guarda al momento -- no hay boton Guardar -- y si el kiosco esta
// abierto se muda en el acto: elegir y no ver que pase nada confunde.

const MOTIVOS = {
  no_esta: 'Esa pantalla ya no está conectada. Vuelve a mirar la lista.',
  es_recepcion: 'En esa pantalla está GymApp: el kiosco a pantalla completa la taparía.',
};

function nombre(p) {
  return 'Pantalla ' + p.numero + (p.modelo ? ' — ' + p.modelo : '') + ' (' + p.ancho + '×' + p.alto + ')';
}

export default function SeccionPantallaKiosco() {
  const [datos, setDatos] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [trabajando, setTrabajando] = useState(false);

  async function cargar() {
    try { setDatos(await window.api.pantallaKiosco.pantallas()); } catch (e) { /* se reintenta al cambiar */ }
  }

  useEffect(() => {
    cargar();
    // Al conectar o desconectar un monitor la lista cambia sola, y tambien al
    // abrir o cerrar el kiosco (para marcar donde esta).
    const dejarPantallas = window.api.pantallaKiosco.onPantallasCambiaron(cargar);
    const dejarCambio = window.api.pantallaKiosco.onCambio(cargar);
    return () => { dejarPantallas(); dejarCambio(); };
  }, []);

  async function elegir(valor) {
    setTrabajando(true);
    setAviso(null);
    const r = await window.api.pantallaKiosco.elegir(valor === 'auto' ? null : valor);
    setTrabajando(false);
    if (!r.ok) {
      setAviso({ tipo: 'error', texto: MOTIVOS[r.motivo] || 'No se pudo elegir esa pantalla.' });
      cargar();
      return;
    }
    setDatos(r);
    setAviso({ tipo: 'ok', texto: r.abierta ? 'Guardado. El kiosco ya se movió.' : 'Guardado. El kiosco saldrá ahí la próxima vez que lo abras.' });
  }

  if (!datos) return null;

  const { pantallas, guardada, elegidaId } = datos;
  // La elegida no esta conectada: se sigue mostrando, o el selector diria
  // "Automatico" y alguien creeria que se perdio la eleccion.
  const elegidaAusente = guardada && elegidaId === null;
  const valor = elegidaId !== null ? String(elegidaId) : (elegidaAusente ? 'ausente' : 'auto');
  const conKiosco = pantallas.find(p => p.kiosco);

  return (
    <section style={{ marginBottom: 40 }}>
      <h2>Pantalla del kiosco</h2>
      <p style={{ maxWidth: 640, color: 'var(--texto-suave)' }}>
        El botón <b>Kiosco en 2.ª pantalla</b> del menú (o <b>F2</b>) muestra el kiosco
        a pantalla completa en otro monitor, para que los clientes marquen mientras
        recepción sigue trabajando. Aquí se elige <b>en cuál</b>. Con dos monitores no
        hace falta: sale en el que no es el de recepción.
      </p>

      <p style={{ maxWidth: 640, margin: '0 0 12px' }}>
        {pantallas.length < 2
          ? <span style={{ color: 'var(--aviso)' }}>Ahora mismo solo hay <b>una pantalla</b> conectada: el kiosco se abriría en una ventana.</span>
          : <>Hay <b>{pantallas.length} pantallas</b> conectadas.{' '}
              {conKiosco
                ? <>El kiosco está abierto en la <b>pantalla {conKiosco.numero}</b>.</>
                : <span style={{ color: 'var(--texto-suave)' }}>El kiosco no está abierto.</span>}
            </>}
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ display: 'inline-block', width: 100 }}>Pantalla</label>
        <select value={valor} disabled={trabajando} style={{ minWidth: 360 }}
                onChange={e => { if (e.target.value !== 'ausente') elegir(e.target.value); }}>
          <option value="auto">Automática (la primera que no sea la de recepción)</option>
          {elegidaAusente && (
            <option value="ausente">{(guardada.label || 'La elegida') + ' (ahora mismo no está conectada)'}</option>
          )}
          {pantallas.map(p => (
            <option key={p.id} value={String(p.id)} disabled={p.recepcion}>
              {nombre(p)}{p.recepcion ? ' — recepción, aquí está GymApp' : ''}
            </option>
          ))}
        </select>
        <button onClick={() => window.api.pantallaKiosco.identificar()} disabled={pantallas.length < 2}
                title="Muestra un número grande en cada monitor durante unos segundos">
          Identificar pantallas
        </button>
      </div>

      {elegidaAusente && (
        <div style={{ marginBottom: 10, padding: '8px 12px', maxWidth: 640,
                      borderRadius: 'var(--radio)', border: '1px solid var(--aviso)',
                      background: 'var(--aviso-fondo)', color: 'var(--aviso)' }}>
          {'⚠'} La pantalla elegida no está conectada. Mientras tanto el kiosco sale
          en otra, y vuelve a la elegida en cuanto se conecte.
        </div>
      )}

      {aviso && (
        <p style={{ marginTop: 6, maxWidth: 640,
                    color: aviso.tipo === 'ok' ? 'var(--exito)' : 'var(--error)' }}>
          {aviso.texto}
        </p>
      )}

      <p style={{ marginTop: 10, maxWidth: 640, fontSize: 12, color: 'var(--texto-tenue)' }}>
        Las pantallas se numeran de izquierda a derecha, como estén ordenadas en
        Windows (Configuración → Sistema → Pantalla). <b>Identificar pantallas</b> pone
        ese número en grande en cada monitor durante unos segundos.
      </p>
    </section>
  );
}
