-- US-012 (part 2 of 2): participant-based direct & group message threads.
--
-- The 'direct'/'group' enum values were added in the PRIOR migration
-- (20260713150000) because Postgres forbids USING a newly-added enum value in the
-- same transaction it is added; Supabase runs each migration in its own txn, so by
-- the time this file runs those values are committed and safe to reference.
--
-- This migration:
--   * widens the event_thread_requires_event CHECK so every non-event thread
--     (team, direct, group) has event_id IS NULL, while event threads still require
--     an event_id;
--   * adds public.thread_participants (the roster of a direct/group thread);
--   * adds a SECURITY DEFINER helper private.is_thread_participant so membership can
--     be tested inside policies without recursively triggering thread_participants
--     RLS (mirrors the private.* helpers moved out of public in 20260707141517);
--   * ADDITIVELY grants participants read/post access on message_threads/messages.
--     RLS is permissive (policies are OR'd) so the existing team/event audience
--     policies ("read threads by audience", "staff create threads", etc.) are left
--     untouched and continue to govern team/event threads exactly as before.

-- ============ Widen the event / non-event CHECK ============
-- Original: (event AND event_id NOT NULL) OR (team AND event_id NULL) -- which
-- rejected direct/group entirely. Using kind <> 'event' keeps event threads
-- requiring an event while letting team/direct/group require event_id IS NULL.
-- Existing 'team' rows (event_id IS NULL) stay valid under the new constraint.
ALTER TABLE public.message_threads DROP CONSTRAINT IF EXISTS event_thread_requires_event;
ALTER TABLE public.message_threads ADD CONSTRAINT event_thread_requires_event
  CHECK ((kind = 'event' AND event_id IS NOT NULL) OR (kind <> 'event' AND event_id IS NULL));

-- ============ thread_participants ============
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

-- ============ Membership helper (SECURITY DEFINER, private schema) ============
-- Referenced by the thread_participants + messages + message_threads policies below.
-- SECURITY DEFINER (owner bypasses RLS) so the lookup does not recursively trigger
-- thread_participants RLS. EXECUTE is locked down like every other private helper.
CREATE OR REPLACE FUNCTION private.is_thread_participant(_user_id uuid, _thread_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.thread_participants tp
    WHERE tp.thread_id = _thread_id AND tp.user_id = _user_id
  );
$$;
REVOKE ALL ON FUNCTION private.is_thread_participant(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ============ thread_participants RLS ============
-- CREATE POLICY has no IF NOT EXISTS, so swallow duplicate_object for idempotency.

-- Participants can see the roster of threads they are in.
DO $$ BEGIN
  CREATE POLICY "read participants if participant" ON public.thread_participants FOR SELECT TO authenticated
    USING (private.is_thread_participant(auth.uid(), thread_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The thread creator adds participants (supports US-013 getOrCreate / createGroup).
DO $$ BEGIN
  CREATE POLICY "creator adds participants" ON public.thread_participants FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id AND t.created_by = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A user may remove (leave) only their own participation.
DO $$ BEGIN
  CREATE POLICY "leave own participation" ON public.thread_participants FOR DELETE TO authenticated
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ message_threads: additive participant policies ============
-- Existing team/event audience policies are left intact; these only ADD access
-- for participants of direct/group threads.

-- Participants can read the threads they belong to.
DO $$ BEGIN
  CREATE POLICY "read threads if participant" ON public.message_threads FOR SELECT TO authenticated
    USING (deleted_at IS NULL AND private.is_thread_participant(auth.uid(), id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Any team member (not just staff) may start a direct/group thread on a shared team.
DO $$ BEGIN
  CREATE POLICY "members create direct or group threads" ON public.message_threads FOR INSERT TO authenticated
    WITH CHECK (
      created_by = auth.uid()
      AND kind IN ('direct', 'group')
      AND event_id IS NULL
      AND private.can_access_team(auth.uid(), team_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ messages: additive participant policies ============
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
