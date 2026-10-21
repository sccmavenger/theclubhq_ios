-- ClubHQ iOS v1 — step 1 of 2.
-- Adds the `player` app role. Kept in its own file because Postgres forbids
-- referencing a newly added enum value in the same transaction (see AGENTS.md).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'player';
