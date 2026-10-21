
-- US-005: Record final score and derived result for game events.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS home_score int;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS away_score int;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS result text;

-- Constrain result to 'win' | 'loss' | 'tie' (NULL allowed until a score is entered).
-- ADD CONSTRAINT has no IF NOT EXISTS, so swallow duplicate_object for idempotency.
DO $$ BEGIN
  ALTER TABLE public.events
    ADD CONSTRAINT events_result_check CHECK (result IN ('win', 'loss', 'tie'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
