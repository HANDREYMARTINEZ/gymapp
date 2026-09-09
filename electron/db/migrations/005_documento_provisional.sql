-- Clientes que entraron sin cedula.
--
-- El Excel del gimnasio trae filas sin Documento, y hasta ahora esas filas se
-- quedaban fuera de la importacion entera: el cliente no existia en la app y no
-- podia ni marcar asistencia. Ahora entran con un documento provisional
-- (1234xxxx) para que existan y puedan usarse, y esta columna es la que dice que
-- esa cedula no es real.
--
-- Hace falta una columna y no basta con mirar si el documento empieza por 1234:
-- una cedula de verdad puede empezar por 1234, y confundirla con una provisional
-- pondria un aviso de "falta el documento" a alguien que si lo tiene. Cuando en
-- la ficha se le escriba la cedula real, la marca se quita sola.
ALTER TABLE clientes ADD COLUMN documento_provisional INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_clientes_provisional ON clientes(documento_provisional);
