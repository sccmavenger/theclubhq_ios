-- US-015: per-thread mute (public.thread_mutes).
--
-- A user can mute a conversation to stop receiving notifications for it WITHOUT
-- leaving the thread. A mute is a PRESENCE row: its mere existence means "muted", so
-- SELECT/INSERT/DELETE is all that is needed (there is no UPDATE — un-muting deletes
-- the row). The row is fully OWNED by the caller, so RLS is simply
-- user_id = auth.uid() on every action; no team/role membership or private.* /
-- public.can_* helper is involved (unlike thread_participants, whose roster is shared
-- with co-participants). unique(thread_id, user_id) keeps mutes idempotent per user.

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

-- ============ thread_mutes RLS (own-rows-only) ============
-- CREATE POLICY has no IF NOT EXISTS, so swallow duplicate_object for idempotency.
-- Every action is scoped to the caller's own rows, so a mute never exposes another
-- user's notification preference.

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
