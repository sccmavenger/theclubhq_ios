-- US-013: team-sharing helpers for direct & group message threads.
--
-- WHY these live in `public` (executable by `authenticated`) rather than in the
-- `private` schema like can_access_team/is_thread_participant:
--   * `public.user_roles` RLS is OWN-ROWS-ONLY (USING (user_id = auth.uid())), so a
--     caller-scoped client CANNOT read another user's roles to check whether they
--     share a team.
--   * The `private.*` helpers have EXECUTE revoked from `authenticated`, so a server
--     function cannot call them via `.rpc(...)`; they only work inside RLS policies.
-- To let the getOrCreateDirectThread / createGroupThread server functions verify a
-- target and pick a shared team, we expose SECURITY DEFINER helpers (owner bypasses
-- RLS) that ARE granted to `authenticated`. They only reveal a boolean / the set of
-- shared team ids relative to the CALLER (auth.uid()), never another user's full role
-- list, so they do not leak cross-tenant data.
--
-- Membership note: staff (head_coach/assistant_coach/team_manager) AND parents both
-- get a public.user_roles row scoped to their team_id (parents via the invite-accept
-- flow), so a user_roles self-join on team_id covers coach<->parent, coach<->coach and
-- parent<->parent sharing. Org-level program_director rows (team_id IS NULL) are
-- intentionally excluded — a direct/group thread is always anchored to a concrete team.

-- Does the caller share at least one team with _other_user? Used to verify a target
-- and reject cross-team participants.
CREATE OR REPLACE FUNCTION public.users_share_team(_other_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles a
    JOIN public.user_roles b
      ON a.team_id = b.team_id AND a.team_id IS NOT NULL
    WHERE a.user_id = auth.uid() AND b.user_id = _other_user
  );
$$;
REVOKE ALL ON FUNCTION public.users_share_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.users_share_team(uuid) TO authenticated, service_role;

-- The set of team ids that BOTH the caller and _other_user belong to. Used to pick a
-- concrete team_id for a new direct/group thread (a team every participant shares).
CREATE OR REPLACE FUNCTION public.shared_team_ids(_other_user uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT a.team_id
  FROM public.user_roles a
  JOIN public.user_roles b
    ON a.team_id = b.team_id AND a.team_id IS NOT NULL
  WHERE a.user_id = auth.uid() AND b.user_id = _other_user;
$$;
REVOKE ALL ON FUNCTION public.shared_team_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_team_ids(uuid) TO authenticated, service_role;
