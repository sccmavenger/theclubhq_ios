
-- Security definer helper: does this user coach the team that owns this player?
CREATE OR REPLACE FUNCTION public.is_head_coach_of_player(_user_id uuid, _player_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players p
    WHERE p.id = _player_id
      AND public.has_team_role(_user_id, p.team_id, 'head_coach')
  );
$$;

DROP POLICY IF EXISTS "Parent reads own links" ON public.parent_player_links;
DROP POLICY IF EXISTS "Parent removes own link" ON public.parent_player_links;

CREATE POLICY "Parent reads own links" ON public.parent_player_links
  FOR SELECT USING (parent_user_id = auth.uid());

CREATE POLICY "Coach reads links on their team" ON public.parent_player_links
  FOR SELECT USING (public.is_head_coach_of_player(auth.uid(), player_id));

CREATE POLICY "Parent removes own link" ON public.parent_player_links
  FOR DELETE USING (parent_user_id = auth.uid());

CREATE POLICY "Coach removes links on their team" ON public.parent_player_links
  FOR DELETE USING (public.is_head_coach_of_player(auth.uid(), player_id));
