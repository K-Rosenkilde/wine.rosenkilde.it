-- Wine fridges (vinkøleskab) and wine racks (vinreol) with shelves, temperature
-- zones and the bottles placed in them.

CREATE TABLE IF NOT EXISTS storages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cellar_id   INTEGER NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'reol',   -- 'koleskab' | 'reol'
  shelf_slots TEXT NOT NULL,                  -- bottles per shelf, top to bottom, e.g. "6,6,6,8"
  note        TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Temperature zones (fridges only). Shelves are 1-based, top to bottom.
CREATE TABLE IF NOT EXISTS storage_zones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_id INTEGER NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT '',
  temp       REAL,                            -- °C
  from_shelf INTEGER NOT NULL,
  to_shelf   INTEGER NOT NULL
);

-- One bottle in one spot.
CREATE TABLE IF NOT EXISTS placements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_id INTEGER NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
  wine_id    INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
  shelf      INTEGER NOT NULL,                -- 1-based
  slot       INTEGER NOT NULL,                -- 1-based
  added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (storage_id, shelf, slot)
);

CREATE INDEX IF NOT EXISTS idx_storages_cellar ON storages(cellar_id);
CREATE INDEX IF NOT EXISTS idx_zones_storage ON storage_zones(storage_id);
CREATE INDEX IF NOT EXISTS idx_placements_storage ON placements(storage_id);
CREATE INDEX IF NOT EXISTS idx_placements_wine ON placements(wine_id);
