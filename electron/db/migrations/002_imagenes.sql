-- Imagenes del sistema: foto de cliente, imagen de producto y logo del gimnasio.
--
-- Van en una tabla aparte y no como columna de clientes/productos por dos
-- razones. Una, los BLOB engordan la fila y SQLite los arrastraria en cada
-- SELECT * del listado de clientes, que se hace en cada busqueda del mostrador.
-- Y dos, asi el mecanismo es uno solo para las tres cosas en vez de tres
-- columnas distintas en tres tablas.
--
-- El contenido va cifrado con la DEK, igual que las plantillas de huella: son
-- fotos de personas y el respaldo tiene que poder salir del local sin exponerlas.
-- Como viven dentro de gym.db, los respaldos y el restaurar que ya existen se
-- las llevan sin tocar nada.
CREATE TABLE imagenes (
  id         INTEGER PRIMARY KEY,
  entidad    TEXT NOT NULL CHECK (entidad IN ('cliente','producto','gimnasio')),
  entidad_id INTEGER,          -- NULL para el logo del gimnasio, que es unico
  mime       TEXT NOT NULL,
  bytes      BLOB NOT NULL,    -- cifrado: iv(12) | tag(16) | datos
  ancho      INTEGER NOT NULL,
  alto       INTEGER NOT NULL,
  tamano     INTEGER NOT NULL, -- bytes en claro, para poder medir el crecimiento
  creada_en  TEXT NOT NULL
);

-- Una imagen por cosa. El COALESCE es para que el logo del gimnasio, que lleva
-- entidad_id NULL, tambien quede sujeto a la unicidad: en SQLite dos NULL no
-- chocan entre si, asi que sin esto se podrian guardar varios logos.
CREATE UNIQUE INDEX idx_imagenes_entidad ON imagenes(entidad, COALESCE(entidad_id, -1));
