-- De donde sale cada movimiento de caja.
--
-- Hasta ahora solo quedaba el texto del concepto ("Venta #12", "Pago de
-- membresia #7", o lo que escribiera el asistente). Para separar en pantalla lo
-- que viene del mostrador de lo que viene de las membresias habria que leer ese
-- texto y adivinar, que se rompe en cuanto alguien escriba un concepto a mano
-- parecido. Se guarda aparte y ya.
ALTER TABLE caja_movimientos ADD COLUMN origen TEXT NOT NULL DEFAULT 'manual';

-- Las filas que ya existen no tienen la columna, asi que se deduce una sola vez
-- de su concepto. Es adivinar, pero adivinar una vez sobre lo que ya paso es
-- distinto de adivinar en cada consulta para siempre.
UPDATE caja_movimientos SET origen = 'venta'
 WHERE concepto LIKE 'Venta #%' OR concepto LIKE 'Anulación de venta #%';

UPDATE caja_movimientos SET origen = 'membresia'
 WHERE concepto LIKE 'Pago de membresía #%' OR concepto LIKE 'Devolución de membresía #%';

CREATE INDEX idx_caja_mov_sesion ON caja_movimientos(sesion_id);
