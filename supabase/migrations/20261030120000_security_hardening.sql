-- Security hardening from the 2026-10-30 review (DECISIONS D-050). Found by
-- supabase/tests/security_probe_check.mjs, which calls PostgREST with a user's own token the way a
-- modified app could. Nothing here changes what the app or older builds do through mobile-api:
-- the server's own writes use the service role (no auth.uid()) and are exempt from the triggers.

-- 1. Direct and group threads. No client has ever created them (only 'team' threads exist), but
--    any team member, teen players included, could create one and post into it. Closing the
--    insert paths keeps the two-adult rule (D-009) true at the database level, not just in the API.
DROP POLICY IF EXISTS "members create direct or group threads" ON public.message_threads;
DROP POLICY IF EXISTS "creator adds participants" ON public.thread_participants;

-- 2. Messages: an author may edit their own text, not move it, re-attribute it or re-date it.
--    A message dated 2099 stayed at the bottom of the chat and stayed editable forever.
CREATE OR REPLACE FUNCTION private.guard_message_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role (account merges, moderation jobs)
  IF NEW.thread_id IS DISTINCT FROM OLD.thread_id OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A message''s thread, author and time can''t be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messages_update_guard ON public.messages;
CREATE TRIGGER messages_update_guard BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.guard_message_update();

-- 3. Teams: a head coach edits the team's details, not which organization it belongs to, who
--    created it (used for team limits), or whether it's deleted. Team colors stay Coach Pro.
CREATE OR REPLACE FUNCTION private.guard_team_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role: club moves, deletion, admin edits
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
    RAISE EXCEPTION 'That change has to go through ClubHQ' USING ERRCODE = '42501';
  END IF;
  IF NEW.brand_color IS DISTINCT FROM OLD.brand_color AND NEW.brand_color IS NOT NULL
     AND NOT public.team_is_pro(NEW.id) THEN
    RAISE EXCEPTION 'Team colors are a Coach Pro feature' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS teams_update_guard ON public.teams;
CREATE TRIGGER teams_update_guard BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION private.guard_team_update();

-- 4. RSVPs: the cutoff (default 4 hours before) and cancellations hold at the database too;
--    mobile-api already refuses these, this covers direct writes.
CREATE OR REPLACE FUNCTION private.guard_rsvp_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _starts timestamptz; _cutoff timestamptz; _cancelled timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT starts_at, rsvp_cutoff_at, cancelled_at INTO _starts, _cutoff, _cancelled FROM public.events WHERE id = NEW.event_id;
  IF _cancelled IS NOT NULL THEN
    RAISE EXCEPTION 'This event was cancelled' USING ERRCODE = '42501';
  END IF;
  IF coalesce(_cutoff, _starts - interval '4 hours') < now() THEN
    RAISE EXCEPTION 'RSVPs are closed for this event' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rsvps_write_guard ON public.rsvps;
CREATE TRIGGER rsvps_write_guard BEFORE INSERT OR UPDATE ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION private.guard_rsvp_write();

REVOKE ALL ON FUNCTION private.guard_message_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_team_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_rsvp_write() FROM PUBLIC, anon, authenticated;
