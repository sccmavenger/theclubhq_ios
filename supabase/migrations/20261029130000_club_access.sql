-- Clubs Phase 0 (DECISIONS D-044): club-wide access comes only from club-level roles.
--
-- Until now every team had its own organization, so "same org" meant "same team". Head and
-- assistant coach rows carry org_id too, so once a club holds many teams the old helpers would
-- let any coach read every team in the club. Club-wide access now requires a role row with
-- team_id IS NULL (program_director today). Directors read team and event chats, not direct or
-- group threads (owner decision 8).

-- 1. Team access: the team's own roles, or a club-level role on the team's club.
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
        OR (ur.team_id IS NULL AND ur.org_id = (SELECT org_id FROM public.teams WHERE id = _team_id))
      )
  );
$function$;

-- 2. Event photos: same rule, plus guardians.
CREATE OR REPLACE FUNCTION public.can_access_event_media(_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (ur.team_id = _team_id
           OR (ur.team_id IS NULL AND ur.org_id = (SELECT org_id FROM public.teams WHERE id = _team_id)))
  ) OR EXISTS (
    SELECT 1 FROM public.parent_player_links l
    JOIN public.players p ON p.id = l.player_id
    WHERE l.parent_user_id = auth.uid() AND p.team_id = _team_id
  );
$function$;

-- 3. Org roles are club-level rows only.
CREATE OR REPLACE FUNCTION private.has_org_role(_user_id uuid, _org_id uuid, _role public.app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND org_id = _org_id AND team_id IS NULL AND role = _role
  );
$function$;

-- 4. Threads: team staff as before; directors no longer get every thread through this helper.
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
        OR private.has_role(_user_id, 'super_admin')
      ) THEN true
      WHEN _audience IN ('parents','both') AND private.parent_can_read_team(_user_id, _team_id) THEN true
      WHEN _audience = 'both' AND private.has_team_role(_user_id, _team_id, 'player') THEN true
      ELSE false
    END;
$function$;

-- 5. Directors read team and event chats on their club's teams (never direct or group threads).
CREATE OR REPLACE FUNCTION private.director_can_read_thread(_user_id uuid, _thread_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.message_threads th
    JOIN public.teams t ON t.id = th.team_id
    WHERE th.id = _thread_id
      AND th.deleted_at IS NULL
      AND th.kind IN ('team', 'event')
      AND private.has_org_role(_user_id, t.org_id, 'program_director')
  );
$function$;
REVOKE ALL ON FUNCTION private.director_can_read_thread(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.director_can_read_thread(uuid, uuid) TO authenticated;

DO $$ BEGIN
  CREATE POLICY "club directors read team chats" ON public.message_threads FOR SELECT TO authenticated
    USING (private.director_can_read_thread(auth.uid(), id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "club directors read team chat messages" ON public.messages FOR SELECT TO authenticated
    USING (private.director_can_read_thread(auth.uid(), thread_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
