-- Club portal Phase A (DECISIONS D-053, docs/CLUB_PORTAL.md). Additive only (D-003).
-- A second director joins with a one-time director code, like coach codes (D-051), so a typo in
-- an email can't hand a stranger access to every team in the club.
ALTER TABLE public.club_invites DROP CONSTRAINT IF EXISTS club_invites_kind_check;
ALTER TABLE public.club_invites ADD CONSTRAINT club_invites_kind_check CHECK (kind IN ('club_code', 'coach', 'director'));

-- Club message history groups one send's rows by (team org, created_at, title).
CREATE INDEX IF NOT EXISTS announcements_from_club_idx ON public.announcements(team_id, created_at DESC) WHERE from_club IS NOT NULL;
