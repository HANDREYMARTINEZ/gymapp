import { useState, useEffect, useRef } from 'react';
import Miniatura from '../components/Miniatura';
import { useCodigoEscaneado } from '../lector/lector';

const pesos = (n) => '$' + (n || 0).toLocaleString('es-CO');

const MOTIVOS = {
  sin_caja_abierta: 'No hay una caja abierta. Toda venta del gimnasio entra a la caja (efectivo, QR, Llave, tarjeta...), así que abre la caja primero.',
  stock_insuficiente: 'No hay existencias suficientes.',
  producto_inactivo: 'Ese producto está inactivo.',
  producto_no_existe: 'Ese producto ya no existe.',
  sin_items: 'Agrega al menos un producto.',
  medio_pago_invalido: 'Elige un medio de pago válido.',
  cantidad_invalida: 'Alguna cantidad no es válida.',
  fiado_sin_cliente: 'Para fiar hay que elegir a qué cliente (activo) se le fía.',
  fecha_invalida: 'La fecha de pago no es válida.',
  fecha_pasada: 'La fecha de pago no puede ser anterior a hoy.',
};

function mensajeDe(r) {
  const base = MOTIVOS[r.motivo] || 'No se pudo completar la venta: ' + r.motivo;
  return r.nombre ? base + ' (' + r.nombre + (r.stockActual != null ? ', quedan ' + r.stockActual : '') + ')' : base;
}

export default function POS({ usuarioActual }) {
  const [productos, setProductos] = useState([]);
  const [imagenes, setImagenes] = useState({});
  const [carrito, setCarrito] = useState([]);
  const [medios, setMedios] = useState([]);
  const [metodoPago, setMetodoPago] = useState('Efectivo');
  const [busqueda, setBusqueda] = useState('');
  const [cajaAbierta, setCajaAbierta] = useState(null);
  const [error, setError] = useState('');
  const [ultimaVenta, setUltimaVenta] = useState(null);
  const [cobrando, setCobrando] = useState(false);
  const buscador = useRef(null);
  // Lo que pasa al escanear o al tocar un producto sale junto al buscador, que
  // es donde se esta mirando, y no abajo en el carrito como el error de cobro.
  const [aviso, setAviso] = useState(null);
  const relojAviso = useRef(null);
  // Fiar: a quien y hasta cuando. 'Fiado' no esta en la lista de medios de pago
  // (no es una forma de pagar); se pide aparte y se anade al desplegable.
  const [medioFiado, setMedioFiado] = useState(null);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [candidatos, setCandidatos] = useState([]);
  const [clienteFiado, setClienteFiado] = useState(null); // { id, nombre, debe }
  const [fiadoHasta, setFiadoHasta] = useState('');
  const esFiado = !!medioFiado && metodoPago === medioFiado;

  function avisar(tipo, texto) {
    if (relojAviso.current) clearTimeout(relojAviso.current);
    setAviso({ tipo, texto });
    // El "+1" se va solo; un problema se queda hasta la siguiente accion.
    if (tipo === 'ok') relojAviso.current = setTimeout(() => setAviso(null), 2500);
  }

  async function cargar() {
    const lista = await window.api.productos.listar();
    setProductos(lista);
    // En un solo viaje, no uno por producto: la cuadricula se repinta despues de
    // cada venta y el mostrador cobra decenas de veces al dia.
    setImagenes(await window.api.imagenes.obtenerVarias('producto', lista.map(p => p.id)));
    setCajaAbierta(await window.api.caja.sesionAbierta() || null);
  }

  useEffect(() => {
    cargar();
    window.api.ventas.mediosPago().then(setMedios);
    window.api.ventas.medioFiado().then(setMedioFiado);
  }, []);

  async function buscarClientes(texto) {
    setBuscaCliente(texto);
    setCandidatos(texto.trim().length >= 2 ? (await window.api.clientes.buscarConEstado(texto)).slice(0, 6) : []);
  }

  // Al elegirlo se muestra cuanto debe ya: no hay tope (decision del 15-sep-2026),
  // asi que es el mostrador el que decide viendo la cifra.
  async function elegirCliente(c) {
    const cuenta = await window.api.fiados.cuenta(c.id);
    setClienteFiado({ id: c.id, nombre: c.nombre, debe: cuenta.total, vencido: cuenta.vencido });
    setBuscaCliente('');
    setCandidatos([]);
    setError('');
  }

  const texto = busqueda.trim().toLowerCase();
  const visibles = texto
    ? productos.filter(p =>
        p.nombre.toLowerCase().includes(texto)
        || (p.categoria || '').toLowerCase().includes(texto)
        || (p.codigo_barras || '').includes(texto))
    : productos;

  // Devuelve el problema si no se puede agregar, o null. Antes se podia meter en
  // el carrito mas de lo que habia y el fallo salia al cobrar, con la fila
  // hecha; ahora sale al tocar o al escanear, que es cuando se puede hacer algo.
  function agregar(producto) {
    const enCarrito = (carrito.find(l => l.productoId === producto.id) || {}).cantidad || 0;
    if (enCarrito + 1 > producto.stock) {
      return producto.stock <= 0
        ? '«' + producto.nombre + '» no tiene existencias.'
        : 'De «' + producto.nombre + '» sólo hay ' + producto.stock + ' en existencia.';
    }
    setError('');
    setUltimaVenta(null);
    setCarrito(prev => {
      const yaEsta = prev.find(l => l.productoId === producto.id);
      if (yaEsta) {
        return prev.map(l => l.productoId === producto.id ? { ...l, cantidad: l.cantidad + 1 } : l);
      }
      return [...prev, {
        productoId: producto.id, nombre: producto.nombre,
        pUnitario: producto.p_venta, cantidad: 1, stock: producto.stock,
        fueraDeCaja: !!producto.fuera_de_caja,
      }];
    });
    return null;
  }

  function agregarYAvisar(producto) {
    const problema = agregar(producto);
    if (problema) avisar('error', problema);
    else avisar('ok', '+1  ' + producto.nombre);
  }

  // El lector, este donde este el cursor: en la cantidad de una linea, en el
  // medio de pago o en ninguna parte. Crear productos queda para el admin en
  // Inventario (decision de Andrey del 12-sep-2026): aqui solo se avisa.
  useCodigoEscaneado(async (codigo) => {
    const p = await window.api.productos.buscarPorCodigo(codigo);
    if (!p) {
      avisar('error', 'El código ' + codigo + ' no está registrado. Hay que crearlo en Inventario.');
      return;
    }
    if (!p.activo) { avisar('error', '«' + p.nombre + '» está desactivado.'); return; }
    agregarYAvisar(p);
  });

  function cambiarCantidad(productoId, cantidad) {
    setError('');
    if (cantidad <= 0) {
      setCarrito(prev => prev.filter(l => l.productoId !== productoId));
      return;
    }
    setCarrito(prev => prev.map(l => l.productoId === productoId ? { ...l, cantidad } : l));
  }

  // El lector de códigos de barras escribe el código y manda Enter. Buscar por
  // código exacto primero permite que el mismo campo sirva para teclear a mano
  // y para escanear, sin un modo aparte.
  async function porEnter() {
    const texto = busqueda.trim();
    if (!texto) return;

    const porCodigo = await window.api.productos.obtenerPorCodigo(texto);
    if (porCodigo) {
      agregarYAvisar(porCodigo);
      setBusqueda('');
      return;
    }
    const coincidencias = visibles;
    if (coincidencias.length === 1) {
      agregarYAvisar(coincidencias[0]);
      setBusqueda('');
    }
  }

  async function cobrar() {
    if (carrito.length === 0) { setError('Agrega al menos un producto.'); return; }
    if (esFiado && !clienteFiado) { setError(MOTIVOS.fiado_sin_cliente); return; }

    setCobrando(true);
    const r = await window.api.ventas.registrar({
      items: carrito.map(l => ({ productoId: l.productoId, cantidad: l.cantidad })),
      metodoPago,
      usuarioId: usuarioActual.id,
      clienteId: esFiado ? clienteFiado.id : undefined,
      fiadoHasta: esFiado && fiadoHasta ? fiadoHasta : undefined,
    });
    setCobrando(false);

    if (!r.ok) { setError(mensajeDe(r)); return; }

    setUltimaVenta({ ...r, metodoPago, clienteNombre: esFiado ? clienteFiado.nombre : null });
    setCarrito([]);
    setError('');
    // El siguiente ticket no tiene por que ser fiado ni del mismo cliente.
    setClienteFiado(null);
    setFiadoHasta('');
    if (esFiado) setMetodoPago('Efectivo');
    cargar();
    if (buscador.current) buscador.current.focus();
  }

  const total = carrito.reduce((s, l) => s + l.pUnitario * l.cantidad, 0);
  const totalFuera = carrito.filter(l => l.fueraDeCaja).reduce((s, l) => s + l.pUnitario * l.cantidad, 0);
  const totalDentro = total - totalFuera;
  // Toda venta del gimnasio entra a la caja con su medio de pago, sea efectivo o
  // no. Un ticket entero de cosas de fuera no la toca, y lo fiado entra cuando se
  // cobre: a esos dos no hay por que exigirles una caja abierta.
  const necesitaCaja = !esFiado && !cajaAbierta && totalDentro > 0;

  return (
    <div>
      <h1>Vender</h1>

      {!cajaAbierta && (
        <p style={{ border: '1px solid var(--aviso)', background: 'var(--aviso-fondo)', padding: 10, maxWidth: 720 }}>
          No hay caja abierta. Solo puedes cobrar lo que sea <b>fuera de caja</b> o
          fiar; para cobrar lo del gimnasio (en efectivo, QR, Llave, tarjeta...)
          ábrela desde <b>Caja</b>.
        </p>
      )}

      {ultimaVenta && (
        <p style={{ border: '1px solid var(--exito)', background: 'var(--exito-fondo)', padding: 10, maxWidth: 720 }}>
          {ultimaVenta.clienteNombre
            ? <>Venta <b>#{ultimaVenta.ventaId}</b> por <b>{pesos(ultimaVenta.total)}</b> fiada a <b>{ultimaVenta.clienteNombre}</b>.</>
            : <>Venta <b>#{ultimaVenta.ventaId}</b> registrada por <b>{pesos(ultimaVenta.total)}</b> en {ultimaVenta.metodoPago}.</>}
        </p>
      )}

      <div style={{ display: 'flex', gap: 30, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <input ref={buscador} autoFocus
                 placeholder="Buscar o escanear código, Enter para agregar"
                 value={busqueda}
                 onChange={e => setBusqueda(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') porEnter(); }}
                 style={{ width: '100%', padding: 6 }} />

          {aviso && (
            <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 'var(--radio)',
                          border: '1px solid ' + (aviso.tipo === 'ok' ? 'var(--exito)' : 'var(--error)'),
                          color: aviso.tipo === 'ok' ? 'var(--exito)' : 'var(--error)' }}>
              {aviso.tipo === 'ok' ? '✔ ' : ''}{aviso.texto}
            </div>
          )}

          {/* 5.13: cuadricula simetrica en vez de tabla. La tarjeta entera es el
              boton: en un mostrador se pulsa la foto del producto, no una
              columna de "Agregar" alineada a la derecha. */}
          <div style={{
            marginTop: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 12,
          }}>
            {visibles.map(p => {
              const agotado = p.stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => agregarYAvisar(p)}
                  disabled={agotado}
                  title={p.nombre}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8,
                    padding: 10, textAlign: 'center',
                    background: 'var(--superficie)',
                    border: '1px solid var(--borde-suave)',
                    borderRadius: 'var(--radio)',
                    opacity: agotado ? 0.45 : 1,
                  }}
                >
                  <Miniatura url={imagenes[p.id]} nombre={p.nombre} lado="100%" radio="var(--radio)" fuente={30} />
                  <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{p.nombre}</div>
                  <div style={{ fontSize: 15 }}>{pesos(p.p_venta)}</div>
                  <div style={{ fontSize: 12, color: agotado ? 'var(--error)' : 'var(--texto-tenue)' }}>
                    {agotado ? 'Sin existencias' : p.stock + ' en existencia'}
                  </div>
                  {p.fuera_de_caja ? (
                    <div style={{ fontSize: 11, color: 'var(--aviso)' }}>Fuera de caja</div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {visibles.length === 0 && (
            <p style={{ marginTop: 16, color: 'var(--texto-tenue)' }}>
              {productos.length === 0 ? 'No hay productos activos. Créalos en Inventario.' : 'Nada coincide.'}
            </p>
          )}
        </div>

        <div style={{ width: 380, border: '1px solid var(--borde-fuerte)', padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Venta actual</h3>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {carrito.map(l => (
                <tr key={l.productoId} style={{ borderBottom: '1px solid var(--borde-suave)' }}>
                  <td>
                    {l.nombre}
                    <br /><small style={{ color: 'var(--texto-tenue)' }}>{pesos(l.pUnitario)} c/u</small>
                    {l.fueraDeCaja && <><br /><small style={{ color: 'var(--aviso)' }}>Fuera de caja</small></>}
                  </td>
                  <td style={{ width: 70 }}>
                    <input type="number" value={l.cantidad} min={0}
                           onChange={e => cambiarCantidad(l.productoId, parseInt(e.target.value, 10) || 0)}
                           style={{ width: 55 }} />
                  </td>
                  <td style={{ textAlign: 'right' }}>{pesos(l.pUnitario * l.cantidad)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => cambiarCantidad(l.productoId, 0)}>×</button>
                  </td>
                </tr>
              ))}
              {carrito.length === 0 && (
                <tr><td style={{ color: 'var(--texto-tenue)', paddingBottom: 8 }}>Sin productos todavía.</td></tr>
              )}
            </tbody>
          </table>

          {totalFuera > 0 && (
            <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--texto-suave)', marginTop: 8 }}>
              <div>Del gimnasio: <b>{pesos(totalDentro)}</b></div>
              <div style={{ color: 'var(--aviso)' }}>Fuera de caja: <b>{pesos(totalFuera)}</b></div>
            </div>
          )}

          <p style={{ fontSize: 22, textAlign: 'right', marginBottom: 6 }}><b>{pesos(total)}</b></p>

          <select value={metodoPago} onChange={e => { setMetodoPago(e.target.value); setError(''); }}
                  style={{ width: '100%', padding: 4 }}>
            {medios.map(m => <option key={m}>{m}</option>)}
            {medioFiado && <option value={medioFiado}>{medioFiado} (se paga después)</option>}
          </select>

          {esFiado && (
            <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--aviso)', borderRadius: 'var(--radio)' }}>
              {clienteFiado ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div>
                    <b>{clienteFiado.nombre}</b>
                    <div style={{ fontSize: 12, color: clienteFiado.debe > 0 ? 'var(--aviso)' : 'var(--texto-tenue)' }}>
                      {clienteFiado.debe > 0
                        ? 'Ya debe ' + pesos(clienteFiado.debe) + (clienteFiado.vencido ? ', con algo vencido' : '')
                          + '. Con esta venta quedaría en ' + pesos(clienteFiado.debe + total) + '.'
                        : 'No debe nada.'}
                    </div>
                  </div>
                  <button onClick={() => setClienteFiado(null)} title="Cambiar de cliente">×</button>
                </div>
              ) : (
                <>
                  <input placeholder="¿A quién se le fía? Nombre o documento"
                         value={buscaCliente} onChange={e => buscarClientes(e.target.value)}
                         style={{ width: '100%' }} />
                  {candidatos.map(c => (
                    <button key={c.id} onClick={() => elegirCliente(c)}
                            style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }}>
                      {c.nombre} <small style={{ color: 'var(--texto-tenue)' }}>{c.documento}</small>
                    </button>
                  ))}
                </>
              )}
              <label style={{ display: 'block', marginTop: 8, fontSize: 13 }}>
                Paga el (opcional)<br />
                <input type="date" value={fiadoHasta} max="2999-12-31"
                       onChange={e => { setFiadoHasta(e.target.value); setError(''); }} />
              </label>
            </div>
          )}

          {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

          <button onClick={cobrar} disabled={cobrando || carrito.length === 0 || necesitaCaja || (esFiado && !clienteFiado)}
                  style={{ marginTop: 10, width: '100%', padding: 10, fontSize: 16 }}>
            {cobrando ? 'Guardando...' : (esFiado ? 'Fiar ' + pesos(total) : 'Cobrar ' + pesos(total))}
          </button>
          {necesitaCaja && (
            <small style={{ color: 'var(--error)' }}>
              Hay {pesos(totalDentro)} del gimnasio en este ticket. Abre la caja para cobrarlo.
            </small>
          )}
          {carrito.length > 0 && (
            <button onClick={() => { setCarrito([]); setError(''); }} style={{ marginTop: 6, width: '100%' }}>
              Vaciar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
