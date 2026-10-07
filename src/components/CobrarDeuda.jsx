import { useState, useEffect } from 'react';

const pesos = (n) => '$' + (n || 0).toLocaleString('es-CO');

const MOTIVOS = {
  monto_invalido: 'Escribe cuánto paga, en número entero.',
  medio_pago_invalido: 'Elige cómo paga.',
  sin_deuda: 'Este cliente ya no debe nada.',
  mas_que_la_deuda: 'Es más de lo que debe.',
  sin_caja_abierta: 'No hay una caja abierta. Todo cobro entra a la caja (efectivo, QR, Llave, tarjeta...), así que abre la caja primero.',
  sin_sesion_abierta: 'No hay una caja abierta. Todo cobro entra a la caja (efectivo, QR, Llave, tarjeta...), así que abre la caja primero.',
};

// La cuenta de un cliente -- membresías con saldo y ventas fiadas de la tienda --
// y el formulario para cobrarla. Lo que se pague se aplica de la deuda más vieja a
// la más nueva; si paga todo, da igual el orden.
//
// Se usa en la ficha del cliente y en la lista de "Deben dinero" de Clientes.
export default function CobrarDeuda({ clienteId, usuarioActual, onCobrado, onCancelar, compacto }) {
  const [cuenta, setCuenta] = useState(null);
  const [medios, setMedios] = useState(['Efectivo']);
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function cargar() {
    const c = await window.api.fiados.cuenta(clienteId);
    setCuenta(c);
    setMonto(c.total > 0 ? String(c.total) : '');
  }

  useEffect(() => {
    cargar();
    window.api.ventas.mediosPago().then(setMedios);
  }, [clienteId]);

  async function cobrar() {
    setError('');
    setGuardando(true);
    const r = await window.api.fiados.cobrar({
      clienteId, monto: parseInt(monto, 10), metodo, nota: nota.trim() || null,
      usuarioId: usuarioActual ? usuarioActual.id : null,
    });
    setGuardando(false);
    if (!r.ok) {
      setError((MOTIVOS[r.motivo] || 'No se pudo cobrar: ' + r.motivo)
        + (r.deuda ? ' Debe ' + pesos(r.deuda) + '.' : ''));
      return;
    }
    onCobrado(r);
  }

  if (!cuenta) return <p style={{ color: 'var(--texto-tenue)' }}>Cargando...</p>;

  return (
    <div style={{ border: '1px solid var(--borde)', padding: compacto ? 10 : 16, marginTop: 8,
                  borderRadius: 'var(--radio)', background: 'var(--superficie-alta)' }}>
      {!compacto && <h4 style={{ marginTop: 0 }}>Cobrar lo que debe</h4>}

      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <tbody>
          {cuenta.items.map(i => (
            <tr key={i.tipo + i.id} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
              <td style={{ padding: '3px 0' }}>
                {i.concepto}
                <br />
                <small style={{ color: i.vencido ? 'var(--error)' : 'var(--texto-tenue)' }}>
                  {i.fiadoHasta
                    ? (i.vencido ? 'Tenía que pagar el ' : 'Paga el ') + i.fiadoHasta
                    : (i.tipo === 'membresia' ? 'Sin fecha de pago: no puede entrar' : 'Sin fecha de pago')}
                </small>
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{pesos(i.saldo)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ paddingTop: 4 }}><b>Total</b></td>
            <td style={{ textAlign: 'right', paddingTop: 4 }}><b>{pesos(cuenta.total)}</b></td>
          </tr>
        </tbody>
      </table>

      {cuenta.total > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <input type="number" min="1" value={monto} placeholder="Cuánto paga"
                   onChange={e => { setMonto(e.target.value); setError(''); }} style={{ width: 120 }} />
            <select value={metodo} onChange={e => { setMetodo(e.target.value); setError(''); }}>
              {medios.map(m => <option key={m}>{m}</option>)}
            </select>
            <input placeholder="Nota (opcional)" value={nota} onChange={e => setNota(e.target.value)}
                   style={{ flex: 1, minWidth: 120 }} />
          </div>
          {parseInt(monto, 10) > 0 && parseInt(monto, 10) < cuenta.total && (
            <p style={{ fontSize: 12, color: 'var(--texto-tenue)', margin: '6px 0 0' }}>
              Abono parcial: se aplica primero a lo más viejo. Quedaría debiendo {pesos(cuenta.total - parseInt(monto, 10))}.
            </p>
          )}
        </>
      )}

      {error && <p style={{ color: 'var(--error)', marginBottom: 0 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {cuenta.total > 0 && (
          <button onClick={cobrar} disabled={guardando}>
            {guardando ? 'Cobrando...' : 'Cobrar ' + pesos(parseInt(monto, 10) || 0)}
          </button>
        )}
        <button onClick={onCancelar} disabled={guardando}>{cuenta.total > 0 ? 'Cancelar' : 'Cerrar'}</button>
      </div>
    </div>
  );
}
