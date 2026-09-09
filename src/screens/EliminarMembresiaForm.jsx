import { useState } from 'react';

const MOTIVOS = {
  no_existe: 'Esa membresía ya no está.',
  ya_anulada: 'Esta membresía ya estaba eliminada.',
  sin_caja_abierta: 'Para devolver efectivo hace falta una caja abierta, porque el dinero sale del cajón. Abre la caja o elige dejar el dinero dentro.',
};

// "Eliminar" de cara al mostrador es anular: la membresia se queda en la base
// marcada y con sus pagos anulados, para no perder el rastro de una operacion
// que movio dinero. Lo unico que hay que decidir aqui es que pasa con lo que el
// cliente ya pago en efectivo.
export default function EliminarMembresiaForm({ membresia, pagado, usuarioActual, onEliminada, onCancelar }) {
  const [devolver, setDevolver] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function eliminar() {
    setGuardando(true);
    const r = await window.api.membresias.anular({
      membresiaId: membresia.id,
      usuarioId: usuarioActual.id,
      motivo: motivo.trim() || null,
      devolverEfectivo: devolver,
    });
    setGuardando(false);
    if (!r.ok) {
      setError(MOTIVOS[r.motivo] || 'No se pudo eliminar: ' + r.motivo);
      return;
    }
    onEliminada();
  }

  const opcion = (valor, titulo, detalle) => (
    <label style={{
      display: 'block', padding: 10, marginTop: 6, cursor: 'pointer',
      borderRadius: 'var(--radio)',
      border: '1px solid ' + (devolver === valor ? 'var(--acento)' : 'var(--borde-suave)'),
      background: devolver === valor ? 'var(--superficie)' : 'transparent',
    }}>
      <input type="radio" name="destino-dinero" checked={devolver === valor}
             onChange={() => { setDevolver(valor); setError(''); }} />
      <b style={{ marginLeft: 6 }}>{titulo}</b>
      <div style={{ fontSize: 12, color: 'var(--texto-suave)', marginLeft: 24 }}>{detalle}</div>
    </label>
  );

  return (
    <div style={{ marginTop: 8, padding: 12, background: 'var(--superficie-alta)', borderRadius: 'var(--radio)' }}
         onClick={e => e.stopPropagation()}>
      <h4 style={{ marginTop: 0 }}>Eliminar {membresia.plan_nombre}</h4>
      <p style={{ fontSize: 13, color: 'var(--texto-suave)', marginTop: 0 }}>
        La membresía queda anulada y sus pagos también. Se conserva en el historial para auditoría.
      </p>

      {pagado > 0 ? (
        <>
          <p style={{ marginBottom: 0 }}>
            Este cliente ya pagó <b>${pagado.toLocaleString('es-CO')}</b> en efectivo. ¿Qué se hace con ese dinero?
          </p>
          {opcion(false, 'Guardar el saldo en caja', 'El dinero se queda en el cajón. No se registra ningún egreso.')}
          {opcion(true, 'Devolverlo al cliente', 'Sale de la caja como egreso. Hace falta una caja abierta.')}
        </>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--texto-suave)' }}>
          No hay pagos en efectivo que devolver.
        </p>
      )}

      <input placeholder="Motivo (opcional)" value={motivo}
             onChange={e => setMotivo(e.target.value)}
             style={{ width: '100%', marginTop: 10 }} />

      {error && <p style={{ color: 'var(--error)', maxWidth: 420 }}>{error}</p>}

      <button onClick={eliminar} disabled={guardando} style={{ marginTop: 10 }}>
        {guardando ? 'Eliminando...' : 'Confirmar eliminación'}
      </button>
      <button onClick={onCancelar} disabled={guardando} style={{ marginLeft: 8 }}>Cancelar</button>
    </div>
  );
}
