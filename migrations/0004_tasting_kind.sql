-- Where a wine was tasted: 'hjemme' | 'restaurant' | 'smagning' | 'andet' ('' = not set).
-- The tasting's existing `place` is the "hvor fra" name (restaurant, friend, shop …).
ALTER TABLE tastings ADD COLUMN kind TEXT NOT NULL DEFAULT '';
UPDATE tastings SET kind = 'smagning' WHERE event_id IS NOT NULL;
