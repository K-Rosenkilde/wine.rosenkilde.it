-- Wine tastings (smagninger): an event with a place and time, one house or several,
-- and the wines poured with their normal price and the offer price on the day.
-- Each person's notes and rating are ordinary tastings linked to the event.

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cellar_id     INTEGER NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  place         TEXT NOT NULL DEFAULT '',
  date          TEXT NOT NULL,                 -- YYYY-MM-DD
  time          TEXT NOT NULL DEFAULT '',      -- HH:MM
  kind          TEXT NOT NULL DEFAULT 'blandet', -- 'hus' (one house) | 'blandet' (several houses)
  house         TEXT NOT NULL DEFAULT '',      -- the house, when kind = 'hus'
  planned_count INTEGER,                       -- number of wines announced
  note          TEXT NOT NULL DEFAULT '',
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_wines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  wine_id      INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  normal_price REAL,                           -- standard price per bottle
  offer_price  REAL,                           -- tilbudspris here and now
  currency     TEXT NOT NULL DEFAULT 'DKK',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, wine_id)
);

ALTER TABLE tastings ADD COLUMN event_id INTEGER REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_cellar ON events(cellar_id);
CREATE INDEX IF NOT EXISTS idx_event_wines_event ON event_wines(event_id);
CREATE INDEX IF NOT EXISTS idx_tastings_event ON tastings(event_id);
