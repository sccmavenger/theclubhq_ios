-- Venmo / Cash App handles so families can pay dues outside the app (DECISIONS D-033).
-- Stored bare (no @ or $); the mobile-api normalizes pasted links. Visible to team members,
-- which is fine: these handles are public by design.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS venmo_username text
    CHECK (venmo_username IS NULL OR venmo_username ~ '^[A-Za-z0-9_-]{5,30}$'),
  ADD COLUMN IF NOT EXISTS cashapp_cashtag text
    CHECK (cashapp_cashtag IS NULL OR (cashapp_cashtag ~ '^[A-Za-z0-9]{1,20}$' AND cashapp_cashtag ~ '[A-Za-z]'));
