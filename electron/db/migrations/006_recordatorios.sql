-- Recordatorios de vencimiento por correo.
--
-- Guarda lo que ya se envio, y esa es toda su razon de ser: sin esta tabla, la
-- app no sabe si a Carolina ya se le escribio este quincena. Abrir y cerrar la
-- app tres veces el mismo dia le mandaria tres correos iguales, que es la forma
-- mas rapida de que un cliente marque el remitente como spam.
--
-- Se anota tambien lo que fallo (ok = 0). Un correo mal escrito en el Excel no
-- puede parar la ronda entera, pero tiene que quedar por escrito para poder
-- corregirlo.
CREATE TABLE recordatorios_enviados (
  id           INTEGER PRIMARY KEY,
  cliente_id   INTEGER NOT NULL REFERENCES clientes(id),
  membresia_id INTEGER REFERENCES membresias(id),
  tipo         TEXT NOT NULL CHECK (tipo IN ('vencida','por_vencer','prueba')),
  email        TEXT NOT NULL,
  fecha        TEXT NOT NULL,
  ok           INTEGER NOT NULL DEFAULT 1,
  error        TEXT
);

CREATE INDEX idx_recordatorios_cliente ON recordatorios_enviados(cliente_id, fecha);
CREATE INDEX idx_recordatorios_fecha   ON recordatorios_enviados(fecha);
