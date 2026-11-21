-- =====================================================================
-- ANTINIEBLA · ACTIVIDADES DEL TALLER · ESQUEMA DE LA BASE (D1)
--
-- Se corre UNA vez, en la consola de la base D1 en Cloudflare
-- (Storage & Databases → D1 → la base → Console). Pegás todo y Execute.
-- Si lo corrés de nuevo no rompe nada: todo va con IF NOT EXISTS.
-- =====================================================================

-- Una fila por día. La fecha es la clave: no puede haber dos consignas
-- el mismo día, y "programar" una es simplemente cargarla con fecha futura.
-- El Worker no la muestra hasta que llega ese día en hora argentina.
CREATE TABLE IF NOT EXISTS consignas (
  fecha   TEXT PRIMARY KEY,          -- 'AAAA-MM-DD'
  titulo  TEXT NOT NULL DEFAULT '',
  texto   TEXT NOT NULL,             -- qué hacer, con la restricción adentro
  regla   TEXT NOT NULL DEFAULT '',  -- lo prohibido, si lo hay
  pista   TEXT NOT NULL DEFAULT '',  -- el truco de oficio
  creada  INTEGER NOT NULL
);

-- Los textos de la gente. ip_hash NO es la IP: es un hash con sal que
-- sirve solo para frenar a alguien que manda veinte seguidos. Con eso
-- no se puede volver a la IP, y así no guardamos un dato que no hace falta.
CREATE TABLE IF NOT EXISTS respuestas (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha   TEXT NOT NULL,
  usuario TEXT NOT NULL,             -- usuario de IG, sin @ y en minúsculas
  texto   TEXT NOT NULL,
  creada  INTEGER NOT NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  oculta  INTEGER NOT NULL DEFAULT 0 -- 1 = moderada, no se muestra
);

CREATE INDEX IF NOT EXISTS resp_por_dia ON respuestas(fecha, creada);
CREATE INDEX IF NOT EXISTS resp_por_ip  ON respuestas(ip_hash, creada);
-- un texto por usuario por día: si alguien quiere corregir, lo borrás
-- desde el panel y lo vuelve a subir
CREATE UNIQUE INDEX IF NOT EXISTS resp_usuario_dia ON respuestas(fecha, usuario);
