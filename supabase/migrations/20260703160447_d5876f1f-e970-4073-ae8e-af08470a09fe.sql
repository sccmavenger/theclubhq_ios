
-- Extend notification kinds
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'message_new';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'event_thread_reply';

-- Thread audience enum
DO $$ BEGIN
  CREATE TYPE public.message_audience AS ENUM ('parents','staff','both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.thread_kind AS ENUM ('team','event');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ message_threads ============
CREATE TABLE public.message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  kind public.thread_kind NOT NULL DEFAULT 'team',
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  audience public.message_audience NOT NULL DEFAULT 'both',
  title text,
  pinned boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT event_thread_requires_event CHECK (
    (kind = 'event' AND event_id IS NOT NULL) OR (kind = 'team' AND event_id IS NULL)
  )
);
CREATE UNIQUE INDEX message_threads_one_per_event ON public.message_threads(event_id) WHERE kind = 'event';
CREATE INDEX message_threads_team_idx ON public.message_threads(team_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_threads TO authenticated;
GRANT ALL ON public.message_threads TO service_role;
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;

-- Helper: does user belong to audience for a team?
CREATE OR REPLACE FUNCTION public.can_read_thread(_user_id uuid, _team_id uuid, _audience public.message_audience)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE
      WHEN _audience IN ('staff','both') AND (
        public.has_team_role(_user_id, _team_id, 'head_coach')
        OR public.has_team_role(_user_id, _team_id, 'assistant_coach')
        OR public.has_team_role(_user_id, _team_id, 'team_manager')
        OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = _team_id AND public.has_org_role(_user_id, t.org_id, 'program_director'))
        OR public.has_role(_user_id, 'super_admin')
      ) THEN true
      WHEN _audience IN ('parents','both') AND public.parent_can_read_team(_user_id, _team_id) THEN true
      ELSE false
    END;
$$;

CREATE POLICY "read threads by audience" ON public.message_threads FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.can_read_thread(auth.uid(), team_id, audience));

CREATE POLICY "staff create threads" ON public.message_threads FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND (
      public.has_team_role(auth.uid(), team_id, 'head_coach')
      OR public.has_team_role(auth.uid(), team_id, 'assistant_coach')
      OR public.has_team_role(auth.uid(), team_id, 'team_manager')
      OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND public.has_org_role(auth.uid(), t.org_id, 'program_director'))
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE POLICY "staff update own threads" ON public.message_threads FOR UPDATE TO authenticated
  USING (
    public.has_team_role(auth.uid(), team_id, 'head_coach')
    OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND public.has_org_role(auth.uid(), t.org_id, 'program_director'))
    OR public.has_role(auth.uid(), 'super_admin')
    OR created_by = auth.uid()
  );

CREATE TRIGGER trg_threads_updated_at BEFORE UPDATE ON public.message_threads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ messages ============
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread_idx ON public.messages(thread_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read messages if thread visible" ON public.messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id
        AND t.deleted_at IS NULL
        AND public.can_read_thread(auth.uid(), t.team_id, t.audience)
    )
  );

CREATE POLICY "post messages if thread visible" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id
        AND t.deleted_at IS NULL
        AND public.can_read_thread(auth.uid(), t.team_id, t.audience)
    )
  );

-- Edit own within 15 minutes
CREATE POLICY "author edits own within window" ON public.messages FOR UPDATE TO authenticated
  USING (
    author_id = auth.uid() AND deleted_at IS NULL AND created_at > now() - interval '15 minutes'
  )
  WITH CHECK (author_id = auth.uid());

-- Head coach / admin can moderate (update to soft-delete) any message on their team
CREATE POLICY "staff moderate messages" ON public.messages FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id
        AND (
          public.has_team_role(auth.uid(), t.team_id, 'head_coach')
          OR EXISTS (SELECT 1 FROM public.teams tt WHERE tt.id = t.team_id AND public.has_org_role(auth.uid(), tt.org_id, 'program_director'))
          OR public.has_role(auth.uid(), 'super_admin')
        )
    )
  );

-- ============ message_reads ============
CREATE TABLE public.message_reads (
  user_id uuid NOT NULL,
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reads TO authenticated;
GRANT ALL ON public.message_reads TO service_role;
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own reads select" ON public.message_reads FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own reads insert" ON public.message_reads FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id AND public.can_read_thread(auth.uid(), t.team_id, t.audience)
    )
  );
CREATE POLICY "own reads update" ON public.message_reads FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============ announcement_reads ============
CREATE TABLE public.announcement_reads (
  user_id uuid NOT NULL,
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcement_reads TO authenticated;
GRANT ALL ON public.announcement_reads TO service_role;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own ann reads select" ON public.announcement_reads FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own ann reads write" ON public.announcement_reads FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.announcements a
      WHERE a.id = announcement_id AND public.can_access_team(auth.uid(), a.team_id)
    )
  );
