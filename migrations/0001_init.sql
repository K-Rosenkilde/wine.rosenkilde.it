-- Vin-dagbog schema (Cloudflare D1 / SQLite).
-- Accounts, sessions, cellars (shared wine lists) and memberships follow the
-- same shape as games.rosenkilde.it (users / sessions / leagues / memberships).

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  pw_hash    TEXT NOT NULL,
  pw_salt    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,             -- sha256(token) hex
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cellars (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cellar_id  INTEGER NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cellar_id, user_id)
);

-- One row per wine (a specific bottling + vintage) in a cellar.
CREATE TABLE IF NOT EXISTS wines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cellar_id   INTEGER NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  producer    TEXT NOT NULL DEFAULT '',   -- house / château / domaine
  vintage     INTEGER,                    -- year; NULL = non-vintage
  grapes      TEXT NOT NULL DEFAULT '',   -- comma-separated
  country     TEXT NOT NULL DEFAULT '',
  region      TEXT NOT NULL DEFAULT '',
  appellation TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '',   -- rød | hvid | rosé | mousserende | dessert | orange
  alcohol     REAL,                       -- % vol
  label_text  TEXT NOT NULL DEFAULT '',   -- what the AI read off the label
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bottle pictures, stored in R2 (full size + thumbnail). wine_id is NULL
-- between upload (scan) and saving the wine.
CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cellar_id  INTEGER NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  wine_id    INTEGER REFERENCES wines(id) ON DELETE CASCADE,
  r2_key     TEXT NOT NULL,               -- full size; thumbnail is r2_key + '.thumb'
  kind       TEXT NOT NULL DEFAULT 'forside',  -- forside | bagside | andet
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Each member keeps their own opinion: one row per tasting per user.
CREATE TABLE IF NOT EXISTS tastings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id    INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,               -- YYYY-MM-DD
  rating     REAL,                        -- 1-5, half steps
  notes      TEXT NOT NULL DEFAULT '',
  aroma      TEXT NOT NULL DEFAULT '',
  taste      TEXT NOT NULL DEFAULT '',
  food       TEXT NOT NULL DEFAULT '',
  place      TEXT NOT NULL DEFAULT '',    -- occasion / where
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id    INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,               -- YYYY-MM-DD
  shop       TEXT NOT NULL DEFAULT '',    -- shop / webshop name
  url        TEXT NOT NULL DEFAULT '',
  price      REAL,                        -- per bottle
  currency   TEXT NOT NULL DEFAULT 'DKK',
  quantity   INTEGER NOT NULL DEFAULT 1,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_cellar ON memberships(cellar_id);
CREATE INDEX IF NOT EXISTS idx_wines_cellar ON wines(cellar_id);
CREATE INDEX IF NOT EXISTS idx_photos_wine ON photos(wine_id);
CREATE INDEX IF NOT EXISTS idx_tastings_wine ON tastings(wine_id);
CREATE INDEX IF NOT EXISTS idx_purchases_wine ON purchases(wine_id);
