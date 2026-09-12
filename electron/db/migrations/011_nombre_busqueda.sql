-- El nombre, otra vez, pero en la forma en que se teclea en el mostrador: sin
-- tildes y en minusculas. LIKE de SQLite solo ignora mayusculas en ASCII, asi
-- que sin esta columna a "SALDANO" con ENE no se le encuentra escribiendo
-- "saldano".
--
-- Se rellena desde JavaScript al conectar (connection.js), porque SQLite no
-- sabe quitar tildes: aqui solo se crea la columna y su indice.
ALTER TABLE clientes ADD COLUMN nombre_busqueda TEXT;
CREATE INDEX idx_clientes_busqueda ON clientes(nombre_busqueda);
