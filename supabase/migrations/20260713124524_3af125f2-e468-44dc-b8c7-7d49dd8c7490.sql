
-- US-004: Record opponent and home/away designation for game events.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS opponent text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS home_away text;

-- Constrain home_away to 'home' | 'away' (NULL allowed for non-games).
-- ADD CONSTRAINT has no IF NOT EXISTS, so swallow duplicate_object for idempotency.
DO $$ BEGIN
  ALTER TABLE public.events
    ADD CONSTRAINT events_home_away_check CHECK (home_away IN ('home', 'away'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
