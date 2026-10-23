-- Co-parent invites (DECISIONS D-035): a team invite bound to one player. Claiming it links
-- the second guardian to the existing child instead of creating a duplicate player.
-- Null player_id = the ordinary team-wide family invite. Additive only (D-003).
ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES public.players(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS team_invites_player_id_idx
  ON public.team_invites (player_id) WHERE player_id IS NOT NULL;
