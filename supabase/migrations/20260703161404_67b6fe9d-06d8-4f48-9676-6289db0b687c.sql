
-- Slice C: RSVP cutoff
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS rsvp_cutoff_at timestamptz;

-- Slice D: sensitive player fields + team opt-in
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS sensitive_fields_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.player_sensitive_fields (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  emergency_contact_name text,
  emergency_contact_phone text,
  allergies text,
  medications text,
  medical_notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_sensitive_fields TO authenticated;
GRANT ALL ON public.player_sensitive_fields TO service_role;
ALTER TABLE public.player_sensitive_fields ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_read_sensitive(_user_id uuid, _player_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.players p
    JOIN public.teams t ON t.id = p.team_id
    WHERE p.id = _player_id
      AND t.sensitive_fields_enabled = true
      AND (
        public.has_team_role(_user_id, p.team_id, 'head_coach')
        OR public.has_team_role(_user_id, p.team_id, 'assistant_coach')
        OR public.has_org_role(_user_id, t.org_id, 'program_director')
        OR public.has_role(_user_id, 'super_admin')
      )
  );
$$;

CREATE POLICY sensitive_read ON public.player_sensitive_fields FOR SELECT TO authenticated
  USING (public.can_read_sensitive(auth.uid(), player_id));
CREATE POLICY sensitive_write ON public.player_sensitive_fields FOR INSERT TO authenticated
  WITH CHECK (public.can_read_sensitive(auth.uid(), player_id));
CREATE POLICY sensitive_update ON public.player_sensitive_fields FOR UPDATE TO authenticated
  USING (public.can_read_sensitive(auth.uid(), player_id))
  WITH CHECK (public.can_read_sensitive(auth.uid(), player_id));

-- Slice E: calendar tokens
CREATE TABLE IF NOT EXISTS public.calendar_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS calendar_tokens_user_team ON public.calendar_tokens(user_id, team_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_tokens TO authenticated;
GRANT ALL ON public.calendar_tokens TO service_role;
ALTER TABLE public.calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY cal_tokens_read_own ON public.calendar_tokens FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY cal_tokens_insert_own ON public.calendar_tokens FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_team(auth.uid(), team_id));
CREATE POLICY cal_tokens_update_own ON public.calendar_tokens FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Slice G: audit logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL,
  target_table text NOT NULL,
  target_id uuid,
  team_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_team ON public.audit_logs(team_id, created_at DESC);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read_team_admins ON public.audit_logs FOR SELECT TO authenticated
  USING (
    team_id IS NOT NULL AND (
      public.has_team_role(auth.uid(), team_id, 'head_coach')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

-- Slice A/G: notification sends extra columns
ALTER TABLE public.notification_sends ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
ALTER TABLE public.notification_sends ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE public.notification_sends ADD COLUMN IF NOT EXISTS provider_message_id text;
