-- Wines created at a tasting stay out of the main wine list until they are bought
-- or moved there by hand. 1 = shown in the wine list, 0 = only under its tasting(s).
ALTER TABLE wines ADD COLUMN in_list INTEGER NOT NULL DEFAULT 1;

-- Existing wines that so far were only met at tastings (poured at an event, never
-- bought, not in a fridge/rack, no notes outside a tasting) leave the wine list too.
UPDATE wines SET in_list = 0
WHERE id IN (SELECT wine_id FROM event_wines)
  AND id NOT IN (SELECT wine_id FROM purchases)
  AND id NOT IN (SELECT wine_id FROM placements)
  AND id NOT IN (SELECT wine_id FROM tastings WHERE event_id IS NULL);
