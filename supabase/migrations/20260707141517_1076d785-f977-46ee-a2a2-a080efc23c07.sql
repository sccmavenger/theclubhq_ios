
-- 1. Private schema for security-sensitive helper functions
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres, service_role;

-- 2. Move SECURITY DEFINER helpers out of public (policies keep working via OID)
ALTER FUNCTION public.has_role(uuid, app_role) SET SCHEMA private;
ALTER FUNCTION public.has_team_role(uuid, uuid, app_role) SET SCHEMA private;
ALTER FUNCTION public.has_org_role(uuid, uuid, app_role) SET SCHEMA private;
ALTER FUNCTION public.can_access_team(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.can_read_sensitive(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.can_read_thread(uuid, uuid, message_audience) SET SCHEMA private;
ALTER FUNCTION public.is_head_coach_of_player(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.is_linked_parent_of_player(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.is_team_staff_of_player(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.parent_can_read_team(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.handle_new_user() SET SCHEMA private;

-- 3. Lock down EXECUTE on the moved helpers
REVOKE ALL ON FUNCTION private.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.has_team_role(uuid, uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.has_org_role(uuid, uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_access_team(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_read_sensitive(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_read_thread(uuid, uuid, message_audience) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_head_coach_of_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_linked_parent_of_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_team_staff_of_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.parent_can_read_team(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 4. Update inner references so functions call each other by their new schema
CREATE OR REPLACE FUNCTION private.can_access_team(_user_id uuid, _team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.team_id = _team_id
        OR ur.org_id = (SELECT org_id FROM public.teams WHERE id = _team_id)
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.parent_can_read_team(_user_id uuid, _team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.parent_player_links l
    JOIN public.players p ON p.id = l.player_id
    WHERE l.parent_user_id = _user_id AND p.team_id = _team_id
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_head_coach_of_player(_user_id uuid, _player_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.players p
    WHERE p.id = _player_id
      AND private.has_team_role(_user_id, p.team_id, 'head_coach')
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_sensitive(_user_id uuid, _player_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.players p
    JOIN public.teams t ON t.id = p.team_id
    WHERE p.id = _player_id
      AND t.sensitive_fields_enabled = true
      AND (
        private.has_team_role(_user_id, p.team_id, 'head_coach')
        OR private.has_team_role(_user_id, p.team_id, 'assistant_coach')
        OR private.has_org_role(_user_id, t.org_id, 'program_director')
        OR private.has_role(_user_id, 'super_admin')
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_team_staff_of_player(_user_id uuid, _player_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.players p
    WHERE p.id = _player_id
      AND (
        private.has_team_role(_user_id, p.team_id, 'head_coach')
        OR private.has_team_role(_user_id, p.team_id, 'assistant_coach')
        OR private.has_team_role(_user_id, p.team_id, 'team_manager')
        OR private.has_role(_user_id, 'super_admin')
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_thread(_user_id uuid, _team_id uuid, _audience message_audience)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN (
        private.has_team_role(_user_id, _team_id, 'head_coach')
        OR private.has_team_role(_user_id, _team_id, 'assistant_coach')
        OR private.has_team_role(_user_id, _team_id, 'team_manager')
        OR EXISTS (
          SELECT 1 FROM public.teams t
          WHERE t.id = _team_id AND private.has_org_role(_user_id, t.org_id, 'program_director')
        )
        OR private.has_role(_user_id, 'super_admin')
      ) THEN true
      WHEN _audience IN ('parents','both') AND private.parent_can_read_team(_user_id, _team_id) THEN true
      ELSE false
    END;
$function$;

-- Keep EXECUTE locked after CREATE OR REPLACE
REVOKE ALL ON FUNCTION private.can_access_team(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.parent_can_read_team(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_head_coach_of_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_read_sensitive(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_team_staff_of_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_read_thread(uuid, uuid, message_audience) FROM PUBLIC, anon, authenticated;

-- 5. Re-point the auth.users trigger to the new location
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

-- 6. Remove privilege-escalation INSERT policies
DROP POLICY IF EXISTS "Users insert own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Parent creates own link" ON public.parent_player_links;
