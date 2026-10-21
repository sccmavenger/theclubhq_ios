-- Fix: RLS policies evaluate as the calling role (`authenticated`). The prototype's
-- hardening migration (20260707141517) revoked USAGE/EXECUTE on the `private` helpers from
-- `authenticated`, which made every helper-based policy fail with
-- "permission denied for function can_access_team".
--
-- This is safe because `private` is NOT in the Data API's exposed schemas, so these
-- functions can't be called directly via /rest/v1/rpc — only from policies and SQL.
-- They are SECURITY DEFINER predicates that return booleans about the caller's own access.
-- (DECISIONS D-027.)
GRANT USAGE ON SCHEMA private TO authenticated;

GRANT EXECUTE ON FUNCTION private.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_team_role(uuid, uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_org_role(uuid, uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_team(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_sensitive(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_thread(uuid, uuid, message_audience) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_head_coach_of_player(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_linked_parent_of_player(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_team_staff_of_player(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.parent_can_read_team(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_thread_participant(uuid, uuid) TO authenticated;

-- Never callable by anonymous visitors; the signup trigger stays owner-only.
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON FUNCTION private.handle_new_user() FROM authenticated, anon;
