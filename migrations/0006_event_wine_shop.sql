-- The shop a wine at a tasting comes from (often the shop behind the wine list).
ALTER TABLE event_wines ADD COLUMN shop TEXT NOT NULL DEFAULT '';
