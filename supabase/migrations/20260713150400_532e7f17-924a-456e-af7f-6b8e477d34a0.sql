-- US-017: schema & storage for event photos.
--
-- Families share game/practice photos on an event. Two moving parts:
--   1. A PRIVATE Supabase Storage bucket `event-media` (raw image bytes live here).
--   2. A `public.event_photos` metadata table (one row per uploaded image), storing
--      the storage_path, an optional caption, the uploader and the owning team.
--
-- RLS ARCHITECTURE NOTE (why two different helper strategies below):
--   * The `private.*` SECURITY DEFINER helpers (can_access_team / parent_can_read_team /
--     has_team_role) have EXECUTE revoked from `authenticated` and USAGE on the `private`
--     schema granted only to postgres/service_role. They keep working inside RLS policies
--     on PUBLIC tables (referenced by OID, evaluated as the definer), so the event_photos
--     TABLE policies call them directly, exactly like the signup-slots policies
--     (20260713140000). event_photos stores team_id directly, so no events subquery.
--   * They are NOT reachable from policies on `storage.objects`. So for the storage
--     policies we expose a self-contained SECURITY DEFINER wrapper in `public`
--     (public.can_access_event_media) that is GRANTed to authenticated -- mirroring the
--     public.users_share_team pattern from 20260713150200 -- and inlines the membership
--     check so it needs no private.* call.
--
-- Files are stored at `<team_id>/<event_id>/<filename>`, so the FIRST path segment is the
-- owning team's id: (storage.foldername(name))[1] (Postgres arrays are 1-indexed). The
-- storage policies gate every read/write on membership of that prefix team. Fine-grained
-- "only the uploader or head_coach may delete" is enforced at the event_photos table +
-- server-fn layer (US-018), not in the storage.objects DELETE policy.

-- ============ Storage bucket (private) ============
-- storage.buckets has a PK on id, so ON CONFLICT DO NOTHING makes the insert idempotent.
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-media', 'event-media', false)
ON CONFLICT (id) DO NOTHING;

-- ============ event_photos table ============
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

-- Grants match the other member-writable tables. No UPDATE: photos are immutable, the
-- caption is set at insert time.
GRANT SELECT, INSERT, DELETE ON public.event_photos TO authenticated;
GRANT ALL ON public.event_photos TO service_role;

ALTER TABLE public.event_photos ENABLE ROW LEVEL SECURITY;

-- ============ Storage membership wrapper (SECURITY DEFINER, public) ============
-- Executable by `authenticated` (unlike the private.* helpers) so it can be called from
-- the storage.objects policies below. Owner bypasses RLS, so it can read user_roles /
-- parent_player_links to resolve membership. It only ever reveals a boolean relative to
-- the CALLER (auth.uid()), so it leaks no cross-tenant data. The membership check mirrors
-- private.can_access_team (team OR org role) plus a linked-parent check.
CREATE OR REPLACE FUNCTION public.can_access_event_media(_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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

-- ============ event_photos RLS (public table -> private.* helpers) ============
-- CREATE POLICY has no IF NOT EXISTS, so swallow duplicate_object for idempotency.
-- team members (coach + linked parents) read; any team member may insert their OWN row;
-- the uploader OR a head_coach may delete.
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

-- ============ storage.objects RLS (event-media bucket -> public wrapper) ============
-- All four actions gate on: object is in the event-media bucket AND the caller is a
-- member of the team named by the first path segment. private.* is not reachable here,
-- so we use the executable public.can_access_event_media wrapper.
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
