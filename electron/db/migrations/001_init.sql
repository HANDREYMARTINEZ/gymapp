PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE usuarios (
  id          INTEGER PRIMARY KEY,
  nombre      TEXT NOT NULL,
  usuario     TEXT NOT NULL UNIQUE,
  hash_pass   TEXT NOT NULL,
  rol         TEXT NOT NULL CHECK (rol IN ('admin','asistente')),
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL
);

CREATE TABLE clientes (
  id             INTEGER PRIMARY KEY,
  documento      TEXT UNIQUE,
  documento_ult4 TEXT,
  nombre         TEXT NOT NULL,
  telefono       TEXT,
  email          TEXT,
  foto           TEXT,
  f_nacimiento   TEXT,
  f_registro     TEXT NOT NULL,
  pin            TEXT,
  contacto_emg   TEXT,
  notas          TEXT,
  activo         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_clientes_nombre ON clientes(nombre);
CREATE INDEX idx_clientes_doc    ON clientes(documento);
CREATE INDEX idx_clientes_ult4   ON clientes(documento_ult4);

CREATE TABLE huellas (
  id          INTEGER PRIMARY KEY,
  cliente_id  INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  dedo        TEXT NOT NULL,
  template    BLOB NOT NULL,
  creado_en   TEXT NOT NULL,
  UNIQUE(cliente_id, dedo)
);

CREATE TABLE planes (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('periodo','ticketera')),
  precio        INTEGER NOT NULL,
  dias_duracion INTEGER,
  num_tickets   INTEGER,
  dias_vigencia INTEGER,
  color         TEXT,
  activo        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE membresias (
  id                INTEGER PRIMARY KEY,
  cliente_id        INTEGER NOT NULL REFERENCES clientes(id),
  plan_id           INTEGER NOT NULL REFERENCES planes(id),
  plan_nombre       TEXT NOT NULL,
  plan_tipo         TEXT NOT NULL,
  f_inicio          TEXT NOT NULL,
  f_fin             TEXT,
  tickets_totales   INTEGER,
  tickets_usados    INTEGER NOT NULL DEFAULT 0,
  precio_pagado     INTEGER NOT NULL,
  descuento         INTEGER NOT NULL DEFAULT 0,
  vendida_por       INTEGER NOT NULL REFERENCES usuarios(id),
  creada_en         TEXT NOT NULL,
  anulada           INTEGER NOT NULL DEFAULT 0,
  anulada_motivo    TEXT
);
CREATE INDEX idx_memb_cliente ON membresias(cliente_id);
CREATE INDEX idx_memb_fin     ON membresias(f_fin);

CREATE TABLE membresia_pausas (
  id            INTEGER PRIMARY KEY,
  membresia_id  INTEGER NOT NULL REFERENCES membresias(id),
  f_inicio      TEXT NOT NULL,
  f_fin         TEXT,
  motivo        TEXT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
  creada_en     TEXT NOT NULL
);
CREATE INDEX idx_pausas_memb ON membresia_pausas(membresia_id);

CREATE TABLE pagos (
  id           INTEGER PRIMARY KEY,
  membresia_id INTEGER NOT NULL REFERENCES membresias(id),
  monto        INTEGER NOT NULL,
  metodo       TEXT NOT NULL,
  fecha        TEXT NOT NULL,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id),
  nota         TEXT,
  anulada      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE asistencias (
  id             INTEGER PRIMARY KEY,
  cliente_id     INTEGER NOT NULL REFERENCES clientes(id),
  fecha_hora     TEXT NOT NULL,
  fecha          TEXT NOT NULL,
  metodo         TEXT NOT NULL CHECK (metodo IN ('huella','pin','manual')),
  membresia_id   INTEGER REFERENCES membresias(id),
  ticket_usado   INTEGER NOT NULL DEFAULT 0,
  registrado_por INTEGER REFERENCES usuarios(id)
);
CREATE UNIQUE INDEX idx_asist_dia ON asistencias(cliente_id, fecha);

CREATE TABLE productos (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL,
  categoria     TEXT,
  p_venta       INTEGER NOT NULL,
  p_costo       INTEGER NOT NULL DEFAULT 0,
  stock         INTEGER NOT NULL DEFAULT 0,
  stock_min     INTEGER NOT NULL DEFAULT 0,
  codigo_barras TEXT UNIQUE,
  activo        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE ventas (
  id          INTEGER PRIMARY KEY,
  fecha       TEXT NOT NULL,
  total       INTEGER NOT NULL,
  metodo_pago TEXT NOT NULL,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  cliente_id  INTEGER REFERENCES clientes(id),
  anulada     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE venta_items (
  id              INTEGER PRIMARY KEY,
  venta_id        INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id     INTEGER NOT NULL REFERENCES productos(id),
  producto_nombre TEXT NOT NULL,
  cantidad        INTEGER NOT NULL,
  p_unitario      INTEGER NOT NULL,
  p_costo_unit    INTEGER NOT NULL
);

CREATE TABLE caja_sesiones (
  id                INTEGER PRIMARY KEY,
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),
  abierta_en        TEXT NOT NULL,
  base_inicial      INTEGER NOT NULL,
  cerrada_en        TEXT,
  efectivo_contado  INTEGER,
  diferencia        INTEGER,
  nota              TEXT
);

CREATE TABLE caja_movimientos (
  id         INTEGER PRIMARY KEY,
  sesion_id  INTEGER REFERENCES caja_sesiones(id),
  tipo       TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  concepto   TEXT NOT NULL,
  monto      INTEGER NOT NULL,
  fecha      TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id)
);

CREATE TABLE auditoria (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER REFERENCES usuarios(id),
  accion      TEXT NOT NULL,
  entidad     TEXT NOT NULL,
  entidad_id  INTEGER,
  fecha       TEXT NOT NULL,
  detalle     TEXT
);

CREATE TABLE config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);