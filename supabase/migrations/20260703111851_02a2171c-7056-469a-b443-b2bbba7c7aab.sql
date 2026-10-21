
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_team_role(uuid, uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_org_role(uuid, uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_team(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.parent_can_read_team(uuid, uuid) FROM PUBLIC, anon;
