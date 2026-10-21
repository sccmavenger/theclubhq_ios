-- US-004
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS opponent text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS home_away text;
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_home_away_check CHECK (home_away IN ('home', 'away'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- US-005
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS home_score int;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS away_score int;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS result text;
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_result_check CHECK (result IN ('win', 'loss', 'tie'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- US-009
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_signup_slots TO authenticated;
GRANT ALL ON public.event_signup_slots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_signup_claims TO authenticated;
GRANT ALL ON public.event_signup_claims TO service_role;
ALTER TABLE public.event_signup_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_signup_claims ENABLE ROW LEVEL SECURITY;
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

-- US-012 part 2
ALTER TABLE public.message_threads DROP CONSTRAINT IF EXISTS event_thread_requires_event;
ALTER TABLE public.message_threads ADD CONSTRAINT event_thread_requires_event
  CHECK ((kind = 'event' AND event_id IS NOT NULL) OR (kind <> 'event' AND event_id IS NULL));
CREATE TABLE IF NOT EXISTS public.thread_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS thread_participants_thread_id_idx ON public.thread_participants (thread_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.thread_participants TO authenticated;
GRANT ALL ON public.thread_participants TO service_role;
ALTER TABLE public.thread_participants ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.is_thread_participant(_user_id uuid, _thread_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.thread_participants tp
    WHERE tp.thread_id = _thread_id AND tp.user_id = _user_id
  );
$$;
REVOKE ALL ON FUNCTION private.is_thread_participant(uuid, uuid) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  CREATE POLICY "read participants if participant" ON public.thread_participants FOR SELECT TO authenticated
    USING (private.is_thread_participant(auth.uid(), thread_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "creator adds participants" ON public.thread_participants FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id AND t.created_by = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "leave own participation" ON public.thread_participants FOR DELETE TO authenticated
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "read threads if participant" ON public.message_threads FOR SELECT TO authenticated
    USING (deleted_at IS NULL AND private.is_thread_participant(auth.uid(), id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "members create direct or group threads" ON public.message_threads FOR INSERT TO authenticated
    WITH CHECK (
      created_by = auth.uid()
      AND kind IN ('direct', 'group')
      AND event_id IS NULL
      AND private.can_access_team(auth.uid(), team_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "read messages if participant" ON public.messages FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id
        AND t.deleted_at IS NULL
        AND private.is_thread_participant(auth.uid(), t.id)
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "post messages if participant" ON public.messages FOR INSERT TO authenticated
    WITH CHECK (
      author_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.message_threads t
        WHERE t.id = thread_id
          AND t.deleted_at IS NULL
          AND private.is_thread_participant(auth.uid(), t.id)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- US-013
CREATE OR REPLACE FUNCTION public.users_share_team(_other_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles a
    JOIN public.user_roles b ON a.team_id = b.team_id AND a.team_id IS NOT NULL
    WHERE a.user_id = auth.uid() AND b.user_id = _other_user
  );
$$;
REVOKE ALL ON FUNCTION public.users_share_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.users_share_team(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.shared_team_ids(_other_user uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT a.team_id FROM public.user_roles a
  JOIN public.user_roles b ON a.team_id = b.team_id AND a.team_id IS NOT NULL
  WHERE a.user_id = auth.uid() AND b.user_id = _other_user;
$$;
REVOKE ALL ON FUNCTION public.shared_team_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_team_ids(uuid) TO authenticated, service_role;

-- US-015
CREATE TABLE IF NOT EXISTS public.thread_mutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT thread_mutes_unique UNIQUE (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS thread_mutes_user_idx ON public.thread_mutes (user_id);
GRANT SELECT, INSERT, DELETE ON public.thread_mutes TO authenticated;
GRANT ALL ON public.thread_mutes TO service_role;
ALTER TABLE public.thread_mutes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY thread_mutes_select_own ON public.thread_mutes FOR SELECT TO authenticated
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY thread_mutes_insert_own ON public.thread_mutes FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY thread_mutes_delete_own ON public.thread_mutes FOR DELETE TO authenticated
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- US-017
CREATE TABLE IF NOT EXISTS public.event_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  caption text,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_photos_event_idx ON public.event_photos (event_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.event_photos TO authenticated;
GRANT ALL ON public.event_photos TO service_role;
ALTER TABLE public.event_photos ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.can_access_event_media(_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (ur.team_id = _team_id OR ur.org_id = (SELECT org_id FROM public.teams WHERE id = _team_id))
  ) OR EXISTS (
    SELECT 1 FROM public.parent_player_links l
    JOIN public.players p ON p.id = l.player_id
    WHERE l.parent_user_id = auth.uid() AND p.team_id = _team_id
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_event_media(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_event_media(uuid) TO authenticated, service_role;
DO $$ BEGIN
  CREATE POLICY "Team + parent read event photos" ON public.event_photos FOR SELECT TO authenticated
    USING (
      private.can_access_team(auth.uid(), team_id)
      OR private.parent_can_read_team(auth.uid(), team_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Member uploads own event photo" ON public.event_photos FOR INSERT TO authenticated
    WITH CHECK (
      uploaded_by = auth.uid()
      AND (
        private.can_access_team(auth.uid(), team_id)
        OR private.parent_can_read_team(auth.uid(), team_id)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Uploader or head coach deletes event photo" ON public.event_photos FOR DELETE TO authenticated
    USING (
      uploaded_by = auth.uid()
      OR private.has_team_role(auth.uid(), team_id, 'head_coach')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "event-media read members" ON storage.objects FOR SELECT TO authenticated
    USING (
      bucket_id = 'event-media'
      AND public.can_access_event_media(((storage.foldername(name))[1])::uuid)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "event-media insert members" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'event-media'
      AND public.can_access_event_media(((storage.foldername(name))[1])::uuid)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "event-media update members" ON storage.objects FOR UPDATE TO authenticated
    USING (
      bucket_id = 'event-media'
      AND public.can_access_event_media(((storage.foldername(name))[1])::uuid)
    )
    WITH CHECK (
      bucket_id = 'event-media'
      AND public.can_access_event_media(((storage.foldername(name))[1])::uuid)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "event-media delete members" ON storage.objects FOR DELETE TO authenticated
    USING (
      bucket_id = 'event-media'
      AND public.can_access_event_media(((storage.foldername(name))[1])::uuid)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;