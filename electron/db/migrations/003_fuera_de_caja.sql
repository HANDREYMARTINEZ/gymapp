-- Productos que se venden en el mostrador pero cuyo dinero no es del gimnasio.
--
-- El caso: en el mismo local se venden cosas que no entran al negocio (mercancia
-- de otro, encargos, lo que sea). El asistente las cobra igual, pero ese efectivo
-- va a otro sitio y no puede contar en el arqueo ni en los ingresos, o el cierre
-- de caja saldria con un sobrante que no existe.
--
-- La marca va en el producto y no en la venta: asi se decide una sola vez, al
-- crearlo, y el mostrador no puede equivocarse cobrando con prisa.
ALTER TABLE productos ADD COLUMN fuera_de_caja INTEGER NOT NULL DEFAULT 0;

-- La misma marca, copiada en la linea de la venta.
--
-- Podria deducirse en cada consulta con un JOIN a productos, pero entonces
-- cambiar hoy la marca de un producto reescribiria el pasado: las ventas de la
-- semana pasada empezarian a contar distinto y ningun arqueo ya cerrado
-- cuadraria. Se copia por lo mismo que ya se copian aqui el nombre y los precios
-- del momento.
ALTER TABLE venta_items ADD COLUMN fuera_de_caja INTEGER NOT NULL DEFAULT 0;
