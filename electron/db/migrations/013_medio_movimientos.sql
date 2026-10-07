-- Con que se pago cada movimiento de caja.
--
-- Hasta aqui caja_movimientos solo guardaba efectivo: lo cobrado por QR, Llave,
-- Nequi o tarjeta no aparecia en la caja, y en el gimnasio parecia que esos
-- pagos "no entraban". Ahora entran todos, cada uno con su medio, y el arqueo
-- sigue contando solo los de 'Efectivo', que es lo unico que hay en el cajon.
--
-- Todo lo que ya existe era efectivo, asi que el valor por defecto lo deja bien.
ALTER TABLE caja_movimientos ADD COLUMN metodo TEXT NOT NULL DEFAULT 'Efectivo';
