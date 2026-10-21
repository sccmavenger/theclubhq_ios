
-- Emergency contacts: model as first-class per-player records with relationship type.
-- Coach staff and linked parents can read/write. No team-level opt-in; always available.

DO $$ BEGIN
  CREATE TYPE public.emergency_contact_relationship AS ENUM ('mother','father','guardian','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.player_emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  relationship public.emergency_contact_relationship NOT NULL,
  phone text NOT NULL,
  name text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pec_player ON public.player_emergency_contacts(player_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_emergency_contacts TO authenticated;
GRANT ALL ON public.player_emergency_contacts TO service_role;

ALTER TABLE public.player_emergency_contacts ENABLE ROW LEVEL SECURITY;

-- Helper: is user a staff member (any coaching role) for the team owning a player?
CREATE OR REPLACE FUNCTION public.is_team_staff_of_player(_user_id uuid, _player_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players p
    WHERE p.id = _player_id
      AND (
        public.has_team_role(_user_id, p.team_id, 'head_coach')
        OR public.has_team_role(_user_id, p.team_id, 'assistant_coach')
        OR public.has_team_role(_user_id, p.team_id, 'team_manager')
        OR public.has_role(_user_id, 'super_admin')
      )
  );
$$;

-- Helper: is user a linked parent to this player?
CREATE OR REPLACE FUNCTION public.is_linked_parent_of_player(_user_id uuid, _player_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.parent_player_links l
    WHERE l.parent_user_id = _user_id AND l.player_id = _player_id
  );
$$;

CREATE POLICY pec_select ON public.player_emergency_contacts FOR SELECT TO authenticated
  USING (
    public.is_team_staff_of_player(auth.uid(), player_id)
    OR public.is_linked_parent_of_player(auth.uid(), player_id)
  );
CREATE POLICY pec_insert ON public.player_emergency_contacts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_team_staff_of_player(auth.uid(), player_id)
    OR public.is_linked_parent_of_player(auth.uid(), player_id)
  );
CREATE POLICY pec_update ON public.player_emergency_contacts FOR UPDATE TO authenticated
  USING (
    public.is_team_staff_of_player(auth.uid(), player_id)
    OR public.is_linked_parent_of_player(auth.uid(), player_id)
  )
  WITH CHECK (
    public.is_team_staff_of_player(auth.uid(), player_id)
    OR public.is_linked_parent_of_player(auth.uid(), player_id)
  );
CREATE POLICY pec_delete ON public.player_emergency_contacts FOR DELETE TO authenticated
  USING (
    public.is_team_staff_of_player(auth.uid(), player_id)
    OR public.is_linked_parent_of_player(auth.uid(), player_id)
  );

CREATE TRIGGER trg_pec_updated_at BEFORE UPDATE ON public.player_emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
