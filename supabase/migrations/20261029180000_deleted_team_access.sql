-- Deleted teams (D-046) are gone for their members at once, not just hidden in the app:
-- team access helpers refuse a team with deleted_at set. Only platform admins (who read through
-- admin_* functions) see it during the 30-day restore window.

CREATE OR REPLACE FUNCTION private.can_access_team(_user_id uuid, _team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.teams t ON t.id = _team_id AND t.deleted_at IS NULL
    WHERE ur.user_id = _user_id
      AND (ur.team_id = _team_id OR (ur.team_id IS NULL AND ur.org_id = t.org_id))
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
    JOIN public.teams t ON t.id = p.team_id AND t.deleted_at IS NULL
    WHERE l.parent_user_id = _user_id AND p.team_id = _team_id
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_manage_team(_user_id uuid, _team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (SELECT 1 FROM public.teams WHERE id = _team_id AND deleted_at IS NOT NULL)
    AND (
      private.has_team_role(_user_id, _team_id, 'head_coach')
      OR EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = _team_id AND private.has_org_role(_user_id, t.org_id, 'program_director')
      )
    );
$function$;

-- Rules that reach a player directly (own child, own login, emergency contacts) also skip deleted teams.
CREATE OR REPLACE FUNCTION private.team_is_deleted(_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.teams WHERE id = _team_id AND deleted_at IS NOT NULL);
$function$;
REVOKE ALL ON FUNCTION private.team_is_deleted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.team_is_deleted(uuid) TO authenticated;

ALTER POLICY "Parents read linked players" ON public.players
  USING (NOT private.team_is_deleted(team_id) AND EXISTS (
    SELECT 1 FROM public.parent_player_links l WHERE l.player_id = players.id AND l.parent_user_id = auth.uid()));
ALTER POLICY "Player reads own player row" ON public.players
  USING (user_id = auth.uid() AND NOT private.team_is_deleted(team_id));
ALTER POLICY pec_select ON public.player_emergency_contacts
  USING ((private.is_team_staff_of_player(auth.uid(), player_id) OR private.is_linked_parent_of_player(auth.uid(), player_id))
    AND NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = player_emergency_contacts.player_id AND private.team_is_deleted(p.team_id)));
