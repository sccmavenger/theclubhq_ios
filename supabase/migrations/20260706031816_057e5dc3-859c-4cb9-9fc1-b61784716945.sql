CREATE OR REPLACE FUNCTION public.can_read_thread(_user_id uuid, _team_id uuid, _audience message_audience)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      -- Staff on the team (or program director / super admin) can read every
      -- thread on their team regardless of audience — they need to see their
      -- own broadcasts to parents, and manage all conversations.
      WHEN (
        public.has_team_role(_user_id, _team_id, 'head_coach')
        OR public.has_team_role(_user_id, _team_id, 'assistant_coach')
        OR public.has_team_role(_user_id, _team_id, 'team_manager')
        OR EXISTS (
          SELECT 1 FROM public.teams t
          WHERE t.id = _team_id AND public.has_org_role(_user_id, t.org_id, 'program_director')
        )
        OR public.has_role(_user_id, 'super_admin')
      ) THEN true
      -- Linked parents can read threads that include the parents audience.
      WHEN _audience IN ('parents','both') AND public.parent_can_read_team(_user_id, _team_id) THEN true
      ELSE false
    END;
$function$;