
-- Allow creators to read back rows they just inserted (fixes returning-clause RLS)
CREATE POLICY "Creators read own teams" ON public.teams
  FOR SELECT USING (created_by = auth.uid());

CREATE POLICY "Creators read own orgs" ON public.organizations
  FOR SELECT USING (created_by = auth.uid());

-- Allow users to grant themselves initial roles during onboarding
CREATE POLICY "Users insert own roles" ON public.user_roles
  FOR INSERT WITH CHECK (user_id = auth.uid());
