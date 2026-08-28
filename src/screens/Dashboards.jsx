import { useState, useEffect } from 'react';

const pesos = (n) => '$' + (n || 0).toLocaleString('es-CO');

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function diaCorto(fechaISO) {
  // Se parte la fecha a mano en vez de new Date('YYYY-MM-DD'), que se
  // interpreta como UTC y en husos negativos muestra el día anterior.
  const [a, m, d] = fechaISO.split('-').map(Number);
  const fecha = new Date(a, m - 1, d);
  return DIAS[fecha.getDay()] + ' ' + d;
}

function fechaLarga(fechaISO) {
  const [a, m, d] = fechaISO.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function diasHasta(fechaISO) {
  const [a, m, d] = fechaISO.split('-').map(Number);
  const objetivo = new Date(a, m - 1, d);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((objetivo - hoy) / 86400000);
}

function Tarjeta({ titulo, children, ancho = 240 }) {
  return (
    <div style={{ border: '1px solid #ccc', padding: 16, width: ancho, minHeight: 120 }}>
      <div style={{ color: '#666', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {titulo}
      </div>
      {children}
    </div>
  );
}

function Cifra({ children }) {
  return <div style={{ fontSize: 30, marginTop: 6 }}><b>{children}</b></div>;
}

function BarrasAsistencias({ serie }) {
  const maximo = Math.max(1, ...serie.map(p => p.n));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120, marginTop: 12 }}>
      {serie.map((p, i) => {
        const esHoy = i === serie.length - 1;
        return (
          <div key={p.fecha} style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 12, color: '#666' }}>{p.n}</div>
            <div
              title={p.n + ' asistencias'}
              style={{
                height: Math.round((p.n / maximo) * 80) + 2,
                background: esHoy ? '#1e88e5' : '#b0bec5',
                borderRadius: '2px 2px 0 0',
              }}
            />
            <div style={{ fontSize: 11, color: esHoy ? '#1e88e5' : '#888', marginTop: 4 }}>
              {diaCorto(p.fecha)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DesgloseMedios({ filas }) {
  if (filas.length === 0) return <p style={{ color: '#888', margin: '6px 0 0' }}>Nada todavía.</p>;
  return (
    <table style={{ width: '100%', marginTop: 6, fontSize: 14 }}>
      <tbody>
        {filas.map(f => (
          <tr key={f.medio}>
            <td style={{ color: '#555' }}>{f.medio}</td>
            <td style={{ textAlign: 'right' }}>{pesos(f.monto)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Dashboards() {
  const [datos, setDatos] = useState(null);

  async function cargar() {
    setDatos(await window.api.dashboard.resumen({ diasAviso: 5, diasSerie: 7 }));
  }

  useEffect(() => { cargar(); }, []);

  if (!datos) return <p>Cargando...</p>;

  const { ingresos, asistenciasHoy, asistenciasSerie, porVencer, bajoMinimo, caja } = datos;

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Hoy</h1>
      <p style={{ color: '#666', marginTop: 0, textTransform: 'capitalize' }}>{fechaLarga(datos.fecha)}</p>
      <button onClick={cargar}>Actualizar</button>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 20 }}>
        <Tarjeta titulo="Ingresos del día">
          <Cifra>{pesos(ingresos.total)}</Cifra>
          <table style={{ width: '100%', marginTop: 8, fontSize: 14 }}>
            <tbody>
              <tr><td style={{ color: '#555' }}>Tienda</td><td style={{ textAlign: 'right' }}>{pesos(ingresos.ventas.total)}</td></tr>
              <tr><td style={{ color: '#555' }}>Membresías</td><td style={{ textAlign: 'right' }}>{pesos(ingresos.membresias.total)}</td></tr>
            </tbody>
          </table>
        </Tarjeta>

        <Tarjeta titulo="Asistencias hoy">
          <Cifra>{asistenciasHoy}</Cifra>
          <div style={{ color: '#666', fontSize: 13, marginTop: 8 }}>
            {asistenciasSerie.reduce((s, p) => s + p.n, 0)} en los últimos 7 días
          </div>
        </Tarjeta>

        <Tarjeta titulo="Caja">
          {caja ? (
            <>
              <Cifra>{pesos(caja.esperado)}</Cifra>
              <div style={{ color: '#666', fontSize: 13, marginTop: 8 }}>
                Debería haber en el cajón.<br />
                Abierta por {caja.sesion.usuario_nombre}.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 18, marginTop: 10 }}>Sin caja abierta</div>
              <div style={{ color: '#666', fontSize: 13, marginTop: 8 }}>
                No se puede cobrar en efectivo hasta abrirla.
              </div>
            </>
          )}
        </Tarjeta>

        <Tarjeta titulo="Por atender">
          <Cifra>{porVencer.length + bajoMinimo.length}</Cifra>
          <div style={{ color: '#666', fontSize: 13, marginTop: 8 }}>
            {porVencer.length} membresía{porVencer.length === 1 ? '' : 's'} por vencer<br />
            {bajoMinimo.length} producto{bajoMinimo.length === 1 ? '' : 's'} bajo mínimo
          </div>
        </Tarjeta>
      </div>

      <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', marginTop: 30 }}>
        <div style={{ minWidth: 380, flex: 1 }}>
          <h2>Asistencias, últimos 7 días</h2>
          <BarrasAsistencias serie={asistenciasSerie} />
        </div>

        <div style={{ minWidth: 300 }}>
          <h2>Cómo entró el dinero</h2>
          <p style={{ margin: '12px 0 2px', color: '#333' }}><b>Tienda</b></p>
          <DesgloseMedios filas={ingresos.ventas.porMedio} />
          <p style={{ margin: '16px 0 2px', color: '#333' }}><b>Membresías</b></p>
          <DesgloseMedios filas={ingresos.membresias.porMedio} />
        </div>
      </div>

      <h2 style={{ marginTop: 34 }}>Membresías por vencer</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 860 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Cliente</th><th>Teléfono</th><th>Plan</th><th>Vence</th>
          </tr>
        </thead>
        <tbody>
          {porVencer.map(m => (
            <tr key={m.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{m.clienteNombre}</td>
              <td>{m.clienteTelefono || '—'}</td>
              <td>{m.planNombre}</td>
              <td>
                {m.planTipo === 'ticketera'
                  ? (m.ticketsRestantes === 1 ? 'Le queda 1 ticket' : 'Le quedan ' + m.ticketsRestantes + ' tickets')
                  : (diasHasta(m.fFin) === 0 ? 'Hoy' : diasHasta(m.fFin) === 1 ? 'Mañana' : 'En ' + diasHasta(m.fFin) + ' días')}
              </td>
            </tr>
          ))}
          {porVencer.length === 0 && (
            <tr><td colSpan={4} style={{ paddingTop: 12, color: '#777' }}>
              Ninguna membresía está por vencer. Las pausadas y las que tienen saldo
              pendiente no cuentan aquí: su estado ya es otro.
            </td></tr>
          )}
        </tbody>
      </table>

      <h2 style={{ marginTop: 34 }}>Productos bajo mínimo</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 860 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Producto</th><th>Categoría</th>
            <th style={{ textAlign: 'right' }}>Quedan</th>
            <th style={{ textAlign: 'right' }}>Mínimo</th>
          </tr>
        </thead>
        <tbody>
          {bajoMinimo.map(p => (
            <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{p.nombre}</td>
              <td>{p.categoria || '—'}</td>
              <td style={{ textAlign: 'right', color: 'darkred', fontWeight: 'bold' }}>{p.stock}</td>
              <td style={{ textAlign: 'right' }}>{p.stock_min}</td>
            </tr>
          ))}
          {bajoMinimo.length === 0 && (
            <tr><td colSpan={4} style={{ paddingTop: 12, color: '#777' }}>Ningún producto está bajo su mínimo.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
