-- New clubs wait for a ClubHQ admin's approval (owner decision 2026-10-30, DECISIONS D-051).
-- Starting a club was free with no team limit, so it sidestepped the Coach Pro team limits.
-- Until a club plan exists, a club's director powers switch on only once an admin approves it.
-- The director's own team (if they made one) works normally while the club waits.

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS club_approved_at timestamptz;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS club_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- Clubs that exist today (the 3D pilot, the demo club) stay on.
UPDATE public.organizations SET club_approved_at = now() WHERE type = 'club' AND club_approved_at IS NULL;

-- Director powers (every club team, club chats) need an approved club. Other org roles are unchanged.
CREATE OR REPLACE FUNCTION private.has_org_role(_user_id uuid, _org_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.org_id = _org_id AND ur.team_id IS NULL AND ur.role = _role
      AND (_role <> 'program_director'
           OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = _org_id AND o.club_approved_at IS NOT NULL))
  );
$$;

-- Only the server creates teams and organizations (mobile-api, with the team limits and club
-- rules). The app never inserted them directly; these policies let a modified app add teams to
-- any organization, including a club waiting for approval.
DROP POLICY IF EXISTS "Head coaches create teams" ON public.teams;
DROP POLICY IF EXISTS "Users create their own orgs" ON public.organizations;

-- An org's creator can't approve their own club, or turn an organization into a club, directly.
CREATE OR REPLACE FUNCTION private.guard_org_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role: mobile-api, admin-api
  IF NEW.type IS DISTINCT FROM OLD.type OR NEW.club_approved_at IS DISTINCT FROM OLD.club_approved_at
     OR NEW.club_approved_by IS DISTINCT FROM OLD.club_approved_by OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'That change has to go through ClubHQ' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS organizations_update_guard ON public.organizations;
CREATE TRIGGER organizations_update_guard BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.guard_org_update();
REVOKE ALL ON FUNCTION private.guard_org_update() FROM PUBLIC, anon, authenticated;

-- Admin portal: clubs waiting for approval, oldest first.
CREATE OR REPLACE FUNCTION public.admin_pending_clubs()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.require_platform_admin();
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x.created_at) FROM (
      SELECT o.id, o.name, o.created_at,
        (SELECT count(*) FROM public.teams t WHERE t.org_id = o.id AND t.deleted_at IS NULL) AS team_count,
        (SELECT jsonb_agg(jsonb_build_object('user_id', ur.user_id, 'name', coalesce(p.full_name, 'Director'), 'email', u.email))
           FROM public.user_roles ur LEFT JOIN public.profiles p ON p.id = ur.user_id LEFT JOIN auth.users u ON u.id = ur.user_id
           WHERE ur.org_id = o.id AND ur.team_id IS NULL AND ur.role = 'program_director') AS directors,
        private.is_internal_user(o.created_by) AS internal
      FROM public.organizations o
      WHERE o.type = 'club' AND o.club_approved_at IS NULL
    ) x
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_pending_clubs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pending_clubs() TO authenticated;
