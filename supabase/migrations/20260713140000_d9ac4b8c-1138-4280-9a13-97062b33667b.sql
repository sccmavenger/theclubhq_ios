
-- US-009: Volunteer/snack signup slots on events.
-- Coaches (head_coach) define signup slots on an event; team members -- including
-- linked parents -- can read them and each claim their own slot (snack, carpool, etc.).
-- Mirrors the events/rsvps RLS style from 20260703111836, EXCEPT the SECURITY DEFINER
-- helper functions were moved from public to the `private` schema in 20260707141517,
-- so every policy must call them with the `private.` prefix.

-- ============ Tables ============

CREATE TABLE IF NOT EXISTS public.event_signup_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  label text NOT NULL,
  slots_needed int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_signup_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES public.event_signup_slots(id) ON DELETE CASCADE,
  claimed_by uuid NOT NULL DEFAULT auth.uid(),
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, claimed_by)
);

CREATE INDEX IF NOT EXISTS event_signup_slots_event_id_idx ON public.event_signup_slots (event_id);
CREATE INDEX IF NOT EXISTS event_signup_claims_slot_id_idx ON public.event_signup_claims (slot_id);

-- ============ Grants (match public.rsvps / public.events) ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_signup_slots TO authenticated;
GRANT ALL ON public.event_signup_slots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_signup_claims TO authenticated;
GRANT ALL ON public.event_signup_claims TO service_role;

-- ============ Row level security ============
ALTER TABLE public.event_signup_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_signup_claims ENABLE ROW LEVEL SECURITY;

-- event_signup_slots: team members (coach + linked parents) read; head_coach writes.
-- CREATE POLICY has no IF NOT EXISTS, so swallow duplicate_object for idempotency.
DO $$ BEGIN
  CREATE POLICY "Team + parent read signup slots" ON public.event_signup_slots FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND (
      private.can_access_team(auth.uid(), e.team_id) OR private.parent_can_read_team(auth.uid(), e.team_id)
    )));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Head coach creates signup slots" ON public.event_signup_slots FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id
      AND private.has_team_role(auth.uid(), e.team_id, 'head_coach')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Head coach updates signup slots" ON public.event_signup_slots FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id
      AND private.has_team_role(auth.uid(), e.team_id, 'head_coach')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id
      AND private.has_team_role(auth.uid(), e.team_id, 'head_coach')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Head coach deletes signup slots" ON public.event_signup_slots FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id
      AND private.has_team_role(auth.uid(), e.team_id, 'head_coach')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- event_signup_claims: team members read; a user may create/delete ONLY their own claim.
DO $$ BEGIN
  CREATE POLICY "Team + parent read signup claims" ON public.event_signup_claims FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.event_signup_slots s
      JOIN public.events e ON e.id = s.event_id
      WHERE s.id = slot_id AND (
        private.can_access_team(auth.uid(), e.team_id) OR private.parent_can_read_team(auth.uid(), e.team_id)
      )
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Member creates own claim" ON public.event_signup_claims FOR INSERT TO authenticated
    WITH CHECK (
      claimed_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.event_signup_slots s
        JOIN public.events e ON e.id = s.event_id
        WHERE s.id = slot_id AND (
          private.can_access_team(auth.uid(), e.team_id) OR private.parent_can_read_team(auth.uid(), e.team_id)
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Member removes own claim" ON public.event_signup_claims FOR DELETE TO authenticated
    USING (claimed_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
