-- Fiados: llevarse algo hoy y pagarlo despues. Decision de Andrey del 15-sep-2026:
-- se fia en membresias y en la tienda, y todo cae en una sola cuenta por cliente.
--
-- Membresias: no hace falta tabla nueva. Una membresia con saldo pendiente YA es
-- una deuda, y los abonos YA viven en `pagos`. Lo unico que faltaba es la fecha
-- en que el cliente dijo que pagaba: hasta ese dia entra al gimnasio aunque deba;
-- pasado ese dia sin pagar, el saldo vuelve a bloquear como siempre.
ALTER TABLE membresias ADD COLUMN fiado_hasta TEXT;

-- Tienda: la venta fiada es una venta normal (sale el stock, quedan sus lineas)
-- con metodo_pago = 'Fiado' y cliente obligatorio. No entra al cajon al venderse:
-- el dinero entra cuando se cobra, abono por abono. La fecha de pago es opcional.
ALTER TABLE ventas ADD COLUMN fiado_hasta TEXT;

-- Cada cobro de una venta fiada. `dentro` es la parte del abono que es del
-- gimnasio: un ticket puede llevar cosas "fuera de caja", y los abonos cubren
-- primero lo del gimnasio. Se guarda en la fila y no se recalcula, para que anular
-- la venta devuelva del cajon exactamente lo que entro en el.
CREATE TABLE venta_abonos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id    INTEGER NOT NULL REFERENCES ventas(id),
  monto       INTEGER NOT NULL CHECK (monto > 0),
  dentro      INTEGER NOT NULL DEFAULT 0 CHECK (dentro >= 0),
  metodo      TEXT NOT NULL,
  fecha       TEXT NOT NULL,
  usuario_id  INTEGER REFERENCES usuarios(id),
  nota        TEXT,
  anulada     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_venta_abonos_venta ON venta_abonos(venta_id);
CREATE INDEX idx_ventas_fiado ON ventas(cliente_id, metodo_pago);
