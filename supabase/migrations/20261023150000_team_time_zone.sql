-- D-037: the team's IANA time zone (e.g. America/Chicago), remembered from the head coach's
-- phone, so weekly repeats and notification times use local time even from older app builds.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS time_zone text CHECK (time_zone ~ '^[A-Za-z0-9_+/-]{1,64}$');
