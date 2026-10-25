-- Internal admin portal (DECISIONS D-041, docs/ADMIN_PORTAL.md). Additive only (D-003).
--
-- Privacy model: admins are NOT given any in-app role (the super_admin app role reads every
-- thread). They read through the admin_* functions below, which run under the admin's own JWT,
-- require MFA (AAL2), and never select messages.body / image_path. The only chat content an
-- admin can see is the snapshot stored in content_reports when a member reports it.

-- ---------------------------------------------------------------------------
-- 1. Admins
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  -- Claimed the first time this email signs in to the portal with a confirmed address.
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('owner','support')),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.platform_admin_role(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.platform_admins WHERE user_id = _user_id AND removed_at IS NULL;
$$;
REVOKE ALL ON FUNCTION private.platform_admin_role(uuid) FROM PUBLIC, anon, authenticated;

-- Raises unless the caller is an active admin on an MFA-verified (AAL2) session.
-- Error messages are stable codes the portal switches on.
CREATE OR REPLACE FUNCTION private.require_platform_admin(_owner_only boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r text := private.platform_admin_role(auth.uid());
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501'; END IF;
  IF coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN RAISE EXCEPTION 'mfa_required' USING ERRCODE = '42501'; END IF;
  IF _owner_only AND r <> 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION private.require_platform_admin(boolean) FROM PUBLIC, anon, authenticated;

-- Staff, QA and demo accounts: excluded from business metrics (still visible in lists).
CREATE OR REPLACE FUNCTION private.is_internal_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins a WHERE a.user_id = _user_id)
      OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _user_id
                 AND (u.email ILIKE '%@teamclubhq.com' OR u.email ILIKE '%.invalid'));
$$;
REVOKE ALL ON FUNCTION private.is_internal_user(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Profile columns the portal reads (written only by Edge Functions)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS acquisition_source text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS signup_via text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended_reason text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS app_version text;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_acquisition_source_check CHECK (acquisition_source IS NULL OR acquisition_source IN (
    'app_store','friend_or_coach','club_or_league','social_media','web_search','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_signup_via_check CHECK (signup_via IS NULL OR signup_via IN (
    'created_team','team_code','co_parent_invite','player_code'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users may edit their own profile row through PostgREST, so these columns are pinned for
-- end-user requests (a suspended user must not be able to clear their own suspension).
CREATE OR REPLACE FUNCTION private.protect_profile_admin_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.acquisition_source := NULL; NEW.signup_via := NULL; NEW.suspended_at := NULL;
      NEW.suspended_reason := NULL; NEW.last_seen_at := NULL; NEW.app_version := NULL;
    ELSE
      NEW.acquisition_source := OLD.acquisition_source; NEW.signup_via := OLD.signup_via;
      NEW.suspended_at := OLD.suspended_at; NEW.suspended_reason := OLD.suspended_reason;
      NEW.last_seen_at := OLD.last_seen_at; NEW.app_version := OLD.app_version;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_profile_admin_columns() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_profile_admin_columns ON public.profiles;
CREATE TRIGGER protect_profile_admin_columns BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.protect_profile_admin_columns();

-- ---------------------------------------------------------------------------
-- 3. Reports and blocks (App Review guideline 1.2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('message','conversation')),
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  thread_id uuid REFERENCES public.message_threads(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT 'other' CHECK (reason IN ('harassment','inappropriate','spam','safety','other')),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  -- What the reporter saw, captured at report time so later edits or deletes can't erase it.
  snapshot_body text,
  snapshot_image_path text, -- object in the private report-evidence bucket
  snapshot_author_name text,
  snapshot_thread_title text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  resolution text CHECK (resolution IS NULL OR resolution IN ('removed','warned','suspended','dismissed')),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_reports_status_idx ON public.content_reports(status, created_at);
CREATE INDEX IF NOT EXISTS content_reports_author_idx ON public.content_reports(author_id);
-- Reporting the same message twice while it's still open is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS content_reports_open_unique
  ON public.content_reports(reporter_id, message_id) WHERE message_id IS NOT NULL AND status = 'open';
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public) VALUES ('report-evidence', 'report-evidence', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON public.user_blocks(blocked_id);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own blocks select" ON public.user_blocks FOR SELECT TO authenticated USING (blocker_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 4. Pro grants: Pro = App Store subscription OR an admin grant (D-041)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pro_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 200),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(user_id, team_id, org_id) = 1),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS pro_grants_user_idx ON public.pro_grants(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pro_grants_team_idx ON public.pro_grants(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pro_grants_org_idx ON public.pro_grants(org_id) WHERE org_id IS NOT NULL;
ALTER TABLE public.pro_grants ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.grant_is_live(g public.pro_grants)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT g.revoked_at IS NULL AND g.starts_at <= now() AND (g.expires_at IS NULL OR g.expires_at > now());
$$;

CREATE OR REPLACE FUNCTION public.user_has_coach_pro(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_store_subscriptions s
    WHERE s.user_id = _user_id
      AND s.status IN ('active','grace_period','billing_retry')
      AND (s.expires_at IS NULL OR s.expires_at > now() - interval '3 days')
  ) OR EXISTS (
    SELECT 1 FROM public.pro_grants g
    WHERE g.user_id = _user_id AND g.revoked_at IS NULL AND g.starts_at <= now()
      AND (g.expires_at IS NULL OR g.expires_at > now())
  );
$$;

-- A team is "Pro" when a head coach holds Coach Pro, or the team or its club has a grant.
CREATE OR REPLACE FUNCTION public.team_is_pro(_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.team_id = _team_id AND ur.role = 'head_coach' AND public.user_has_coach_pro(ur.user_id)
  ) OR EXISTS (
    SELECT 1 FROM public.pro_grants g JOIN public.teams t ON t.id = _team_id
    WHERE (g.team_id = _team_id OR g.org_id = t.org_id)
      AND g.revoked_at IS NULL AND g.starts_at <= now()
      AND (g.expires_at IS NULL OR g.expires_at > now())
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. First-party usage analytics (D-041): no third party, deleted with the account
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  source text NOT NULL CHECK (source IN ('app','server')),
  props jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(props) = 'object' AND pg_column_size(props) <= 1024),
  app_version text CHECK (app_version IS NULL OR char_length(app_version) <= 32),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_created_idx ON public.usage_events(created_at);
CREATE INDEX IF NOT EXISTS usage_events_user_idx ON public.usage_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS usage_events_name_idx ON public.usage_events(name, created_at);
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- One row per user per day they used the app: DAU/WAU/MAU without any client change.
CREATE TABLE IF NOT EXISTS public.user_activity_days (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS user_activity_days_day_idx ON public.user_activity_days(day);
ALTER TABLE public.user_activity_days ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. Subscription history for revenue metrics
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_store_subscriptions ADD COLUMN IF NOT EXISTS in_trial boolean NOT NULL DEFAULT false;
ALTER TABLE public.app_store_subscriptions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.app_store_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type text NOT NULL,
  subtype text,
  original_transaction_id text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  product_id text,
  environment text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_store_events_received_idx ON public.app_store_events(received_at);
ALTER TABLE public.app_store_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 7. Account control, broadcasts, admin alerts
-- ---------------------------------------------------------------------------
-- No FK to auth.users: the row outlives the account as a record that the deletion happened.
CREATE TABLE IF NOT EXISTS public.account_deletions (
  user_id uuid PRIMARY KEY,
  email text, -- cleared when the deletion completes
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  legal boolean NOT NULL DEFAULT false,
  requested_by uuid,
  scheduled_for timestamptz NOT NULL,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  segment jsonb NOT NULL,
  is_test boolean NOT NULL DEFAULT false,
  recipients integer NOT NULL DEFAULT 0,
  with_devices integer NOT NULL DEFAULT 0,
  delivered integer NOT NULL DEFAULT 0,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%'),
  p256dh text NOT NULL,
  auth text NOT NULL,
  alerts text[] NOT NULL DEFAULT ARRAY['report','team','subscription','account'],
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz
);
ALTER TABLE public.admin_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 8. Activity timeline per team (counts and timestamps only, never content)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW private.team_activity AS
  SELECT th.team_id, m.created_at AS at, 'message'::text AS kind
    FROM public.messages m JOIN public.message_threads th ON th.id = m.thread_id
  UNION ALL SELECT e.team_id, e.created_at, 'event' FROM public.events e
  UNION ALL SELECT e.team_id, r.updated_at, 'rsvp' FROM public.rsvps r JOIN public.events e ON e.id = r.event_id
  UNION ALL SELECT a.team_id, a.created_at, 'announcement' FROM public.announcements a
  UNION ALL SELECT ur.team_id, ur.created_at, 'member' FROM public.user_roles ur WHERE ur.team_id IS NOT NULL;
REVOKE ALL ON private.team_activity FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Portal read functions. Each runs under the admin's JWT and starts with
--    require_platform_admin(). None of them read messages.body or image_path.
-- ---------------------------------------------------------------------------

-- Who am I? Claims a pending admin row by confirmed email. Works before MFA so the portal
-- knows whether to ask for enrollment or a code.
CREATE OR REPLACE FUNCTION public.admin_whoami()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  em text;
  confirmed boolean;
  a public.platform_admins;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('role', NULL); END IF;
  SELECT lower(email), email_confirmed_at IS NOT NULL INTO em, confirmed FROM auth.users WHERE id = uid;
  SELECT * INTO a FROM public.platform_admins WHERE user_id = uid AND removed_at IS NULL;
  IF a.id IS NULL AND confirmed THEN
    UPDATE public.platform_admins SET user_id = uid
      WHERE email = em AND user_id IS NULL AND removed_at IS NULL RETURNING * INTO a;
  END IF;
  RETURN jsonb_build_object('role', a.role, 'email', em, 'user_id', uid, 'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'));
END $$;

CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM private.require_platform_admin();
  WITH real_users AS (
    SELECT u.id, u.created_at FROM auth.users u
    WHERE u.email NOT ILIKE '%@teamclubhq.com' AND u.email NOT ILIKE '%.invalid'
      AND NOT EXISTS (SELECT 1 FROM public.platform_admins a WHERE a.user_id = u.id)
  ), real_teams AS (
    SELECT t.id, t.created_at, t.archived_at FROM public.teams t WHERE NOT private.is_internal_user(t.created_by)
  ), weeks AS (
    SELECT generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS wk
  ), subs AS (
    SELECT s.* FROM public.app_store_subscriptions s
    WHERE s.status IN ('active','grace_period','billing_retry') AND (s.expires_at IS NULL OR s.expires_at > now() - interval '3 days')
  )
  SELECT jsonb_build_object(
    'users_total', (SELECT count(*) FROM real_users),
    'users_new_7d', (SELECT count(*) FROM real_users WHERE created_at > now() - interval '7 days'),
    'users_active_7d', (SELECT count(DISTINCT d.user_id) FROM public.user_activity_days d JOIN real_users r ON r.id = d.user_id WHERE d.day > current_date - 7),
    'users_active_30d', (SELECT count(DISTINCT d.user_id) FROM public.user_activity_days d JOIN real_users r ON r.id = d.user_id WHERE d.day > current_date - 30),
    'teams_total', (SELECT count(*) FROM real_teams WHERE archived_at IS NULL),
    'teams_new_7d', (SELECT count(*) FROM real_teams WHERE created_at > now() - interval '7 days'),
    'teams_active_7d', (SELECT count(DISTINCT a.team_id) FROM private.team_activity a JOIN real_teams t ON t.id = a.team_id WHERE a.at > now() - interval '7 days' AND t.archived_at IS NULL),
    'clubs_total', (SELECT count(*) FROM public.organizations o WHERE o.type = 'club' AND NOT private.is_internal_user(o.created_by)),
    'internal_users', (SELECT count(*) FROM auth.users) - (SELECT count(*) FROM real_users),
    'reports_open', (SELECT count(*) FROM public.content_reports WHERE status = 'open'),
    'reports_oldest_open_at', (SELECT min(created_at) FROM public.content_reports WHERE status = 'open'),
    'deletions_due', (SELECT count(*) FROM public.account_deletions WHERE completed_at IS NULL AND cancelled_at IS NULL AND scheduled_for <= now()),
    'pro_paid', (SELECT count(*) FROM subs WHERE environment = 'Production' AND NOT in_trial),
    'pro_trial', (SELECT count(*) FROM subs WHERE environment = 'Production' AND in_trial),
    'pro_sandbox', (SELECT count(*) FROM subs WHERE environment <> 'Production'),
    'pro_cancelling', (SELECT count(*) FROM subs WHERE environment = 'Production' AND NOT auto_renew),
    'pro_granted', (SELECT count(*) FROM public.pro_grants g WHERE private.grant_is_live(g)),
    -- List prices (D-011); Apple's proceeds report is the source of truth for payouts.
    'mrr_cents_estimate', (SELECT coalesce(sum(CASE WHEN product_id LIKE '%yearly' THEN 6999.0 / 12 ELSE 999 END), 0)::int
                           FROM subs WHERE environment = 'Production' AND NOT in_trial),
    'weekly', (SELECT jsonb_agg(jsonb_build_object(
        'week', w.wk::date,
        'signups', (SELECT count(*) FROM real_users r WHERE r.created_at >= w.wk AND r.created_at < w.wk + interval '1 week'),
        'new_teams', (SELECT count(*) FROM real_teams t WHERE t.created_at >= w.wk AND t.created_at < w.wk + interval '1 week'),
        'active_users', (SELECT count(DISTINCT d.user_id) FROM public.user_activity_days d JOIN real_users r ON r.id = d.user_id
                         WHERE d.day >= w.wk::date AND d.day < (w.wk + interval '1 week')::date),
        'active_teams', (SELECT count(DISTINCT a.team_id) FROM private.team_activity a JOIN real_teams t ON t.id = a.team_id
                         WHERE a.at >= w.wk AND a.at < w.wk + interval '1 week')
      ) ORDER BY w.wk) FROM weeks w),
    'acquisition', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
        SELECT coalesce(p.acquisition_source, 'unknown') AS k, count(*) AS n
        FROM public.profiles p JOIN real_users r ON r.id = p.id
        WHERE p.signup_via = 'created_team' GROUP BY 1) x),
    'signup_via', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
        SELECT coalesce(p.signup_via, 'unknown') AS k, count(*) AS n
        FROM public.profiles p JOIN real_users r ON r.id = p.id GROUP BY 1) x),
    'feature_usage_30d', (SELECT coalesce(jsonb_agg(x ORDER BY x.events DESC), '[]'::jsonb) FROM (
        SELECT e.name, count(*) AS events, count(DISTINCT e.user_id) AS users, count(DISTINCT e.team_id) AS teams
        FROM public.usage_events e JOIN real_users r ON r.id = e.user_id
        WHERE e.created_at > now() - interval '30 days' GROUP BY e.name LIMIT 60) x)
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_teams()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.require_platform_admin();
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x.last_activity_at DESC NULLS LAST) FROM (
      SELECT t.id, t.name, t.sport, t.age_group, t.season, t.created_at, t.archived_at,
        private.is_internal_user(t.created_by) AS internal,
        jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type) AS org,
        (SELECT jsonb_agg(coalesce(p.full_name, 'Coach')) FROM public.user_roles ur LEFT JOIN public.profiles p ON p.id = ur.user_id
           WHERE ur.team_id = t.id AND ur.role = 'head_coach') AS head_coaches,
        (SELECT count(DISTINCT ur.user_id) FROM public.user_roles ur WHERE ur.team_id = t.id AND ur.role IN ('head_coach','assistant_coach','team_manager')) AS staff,
        (SELECT count(DISTINCT l.parent_user_id) FROM public.parent_player_links l JOIN public.players pl ON pl.id = l.player_id
           WHERE pl.team_id = t.id AND pl.archived_at IS NULL) AS families,
        (SELECT count(*) FROM public.players pl WHERE pl.team_id = t.id AND pl.archived_at IS NULL) AS players,
        (SELECT max(a.at) FROM private.team_activity a WHERE a.team_id = t.id) AS last_activity_at,
        (SELECT count(*) FROM public.events e WHERE e.team_id = t.id AND e.cancelled_at IS NULL
           AND e.starts_at BETWEEN now() AND now() + interval '14 days') AS events_next_14d,
        (SELECT count(*) FROM public.messages m JOIN public.message_threads th ON th.id = m.thread_id
           WHERE th.team_id = t.id AND m.created_at > now() - interval '7 days') AS messages_7d,
        (SELECT count(*) FROM public.rsvps r JOIN public.events e ON e.id = r.event_id
           WHERE e.team_id = t.id AND r.updated_at > now() - interval '30 days') AS rsvps_30d,
        public.team_is_pro(t.id) AS is_pro
      FROM public.teams t JOIN public.organizations o ON o.id = t.org_id
    ) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_team(_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.teams;
BEGIN
  PERFORM private.require_platform_admin();
  SELECT * INTO t FROM public.teams WHERE id = _team_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object(
    'team', jsonb_build_object('id', t.id, 'name', t.name, 'sport', t.sport, 'age_group', t.age_group, 'season', t.season,
      'created_at', t.created_at, 'archived_at', t.archived_at, 'time_zone', t.time_zone, 'brand_color', t.brand_color,
      'is_pro', public.team_is_pro(t.id), 'internal', private.is_internal_user(t.created_by),
      'has_venmo', t.venmo_username IS NOT NULL, 'has_cashapp', t.cashapp_cashtag IS NOT NULL),
    'org', (SELECT jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type,
              'team_count', (SELECT count(*) FROM public.teams x WHERE x.org_id = o.id))
            FROM public.organizations o WHERE o.id = t.org_id),
    'members', (SELECT coalesce(jsonb_agg(m ORDER BY m.name), '[]'::jsonb) FROM (
        SELECT u.id AS user_id, u.email, coalesce(p.full_name, u.email) AS name,
          array_agg(DISTINCT ur.role::text) AS roles, min(ur.created_at) AS joined_at, p.suspended_at
        FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id LEFT JOIN public.profiles p ON p.id = u.id
        WHERE ur.team_id = t.id GROUP BY u.id, u.email, p.full_name, p.suspended_at) m),
    'players', (SELECT coalesce(jsonb_agg(x ORDER BY x.last_name, x.first_name), '[]'::jsonb) FROM (
        SELECT pl.id, pl.first_name, pl.last_name, pl.jersey_number, pl.user_id IS NOT NULL AS has_account, pl.created_at,
          (SELECT count(*) FROM public.parent_player_links l WHERE l.player_id = pl.id) AS guardians
        FROM public.players pl WHERE pl.team_id = t.id AND pl.archived_at IS NULL) x),
    'invite', (SELECT jsonb_build_object('token', i.token, 'expires_at', i.expires_at) FROM public.team_invites i
               WHERE i.team_id = t.id AND i.player_id IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
               ORDER BY i.created_at DESC LIMIT 1),
    'threads', (SELECT coalesce(jsonb_agg(x ORDER BY x.last_message_at DESC NULLS LAST), '[]'::jsonb) FROM (
        SELECT th.id, th.title, th.kind, th.audience, th.created_at, th.deleted_at,
          (SELECT count(*) FROM public.messages m WHERE m.thread_id = th.id) AS message_count,
          (SELECT max(m.created_at) FROM public.messages m WHERE m.thread_id = th.id) AS last_message_at
        FROM public.message_threads th WHERE th.team_id = t.id) x),
    'counts', jsonb_build_object(
      'events_total', (SELECT count(*) FROM public.events e WHERE e.team_id = t.id),
      'events_upcoming', (SELECT count(*) FROM public.events e WHERE e.team_id = t.id AND e.starts_at > now() AND e.cancelled_at IS NULL),
      'rsvps_30d', (SELECT count(*) FROM public.rsvps r JOIN public.events e ON e.id = r.event_id WHERE e.team_id = t.id AND r.updated_at > now() - interval '30 days'),
      'messages_7d', (SELECT count(*) FROM public.messages m JOIN public.message_threads th ON th.id = m.thread_id WHERE th.team_id = t.id AND m.created_at > now() - interval '7 days'),
      'messages_total', (SELECT count(*) FROM public.messages m JOIN public.message_threads th ON th.id = m.thread_id WHERE th.team_id = t.id),
      'announcements', (SELECT count(*) FROM public.announcements a WHERE a.team_id = t.id),
      'last_activity_at', (SELECT max(a.at) FROM private.team_activity a WHERE a.team_id = t.id)),
    'dues', (SELECT jsonb_build_object('requests', count(DISTINCT r.id),
               'paid_cents', coalesce(sum(i.amount_cents) FILTER (WHERE i.status = 'paid'), 0),
               'unpaid_cents', coalesce(sum(i.amount_cents) FILTER (WHERE i.status = 'unpaid'), 0))
             FROM public.dues_requests r LEFT JOIN public.dues_items i ON i.request_id = r.id WHERE r.team_id = t.id),
    'grants', (SELECT coalesce(jsonb_agg(g ORDER BY g.created_at DESC), '[]'::jsonb) FROM public.pro_grants g
               WHERE g.team_id = t.id OR g.org_id = t.org_id),
    'reports', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'reason', r.reason, 'created_at', r.created_at)
                  ORDER BY r.created_at DESC), '[]'::jsonb) FROM public.content_reports r WHERE r.team_id = t.id),
    'audit', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
        SELECT l.id, l.action, l.target_table, l.target_id, l.metadata, l.created_at, u.email AS actor_email
        FROM public.audit_logs l LEFT JOIN auth.users u ON u.id = l.actor_user_id
        WHERE l.team_id = t.id ORDER BY l.created_at DESC LIMIT 50) x)
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_search_users(_q text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  needle text := '%' || replace(replace(replace(coalesce(trim(_q), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
BEGIN
  PERFORM private.require_platform_admin();
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT u.id, u.email, p.full_name, u.created_at, u.last_sign_in_at, p.last_seen_at, p.suspended_at,
        private.is_internal_user(u.id) AS internal,
        (SELECT array_agg(DISTINCT ur.role::text) FROM public.user_roles ur WHERE ur.user_id = u.id) AS roles,
        (SELECT count(DISTINCT ur.team_id) FROM public.user_roles ur WHERE ur.user_id = u.id) AS teams
      FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
      WHERE coalesce(trim(_q), '') = '' OR u.email ILIKE needle OR p.full_name ILIKE needle OR u.id::text = trim(_q)
      ORDER BY u.created_at DESC LIMIT 50) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_user(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u auth.users;
  p public.profiles;
BEGIN
  PERFORM private.require_platform_admin();
  SELECT * INTO u FROM auth.users WHERE id = _user_id;
  IF u.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id = _user_id;
  RETURN jsonb_build_object(
    'account', jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
      'email_confirmed_at', u.email_confirmed_at, 'banned_until', u.banned_until,
      'providers', u.raw_app_meta_data -> 'providers', 'internal', private.is_internal_user(u.id),
      'is_admin', private.platform_admin_role(u.id)),
    'profile', jsonb_build_object('full_name', p.full_name, 'phone', p.phone, 'acquisition_source', p.acquisition_source,
      'signup_via', p.signup_via, 'last_seen_at', p.last_seen_at, 'app_version', p.app_version,
      'suspended_at', p.suspended_at, 'suspended_reason', p.suspended_reason),
    'memberships', (SELECT coalesce(jsonb_agg(x ORDER BY x.team_name), '[]'::jsonb) FROM (
        SELECT t.id AS team_id, t.name AS team_name, t.archived_at, array_agg(DISTINCT ur.role::text) AS roles
        FROM public.user_roles ur JOIN public.teams t ON t.id = ur.team_id
        WHERE ur.user_id = u.id GROUP BY t.id, t.name, t.archived_at) x),
    'org_roles', (SELECT coalesce(jsonb_agg(jsonb_build_object('org_id', o.id, 'org_name', o.name, 'role', ur.role)), '[]'::jsonb)
                  FROM public.user_roles ur JOIN public.organizations o ON o.id = ur.org_id
                  WHERE ur.user_id = u.id AND ur.team_id IS NULL),
    'children', (SELECT coalesce(jsonb_agg(jsonb_build_object('player_id', pl.id, 'name', pl.first_name || ' ' || pl.last_name,
                    'team_id', pl.team_id, 'team_name', t.name, 'relationship', l.relationship, 'archived_at', pl.archived_at)), '[]'::jsonb)
                 FROM public.parent_player_links l JOIN public.players pl ON pl.id = l.player_id JOIN public.teams t ON t.id = pl.team_id
                 WHERE l.parent_user_id = u.id),
    'player_self', (SELECT coalesce(jsonb_agg(jsonb_build_object('player_id', pl.id, 'team_id', pl.team_id, 'team_name', t.name)), '[]'::jsonb)
                    FROM public.players pl JOIN public.teams t ON t.id = pl.team_id WHERE pl.user_id = u.id),
    'devices', (SELECT coalesce(jsonb_agg(jsonb_build_object('environment', d.environment, 'updated_at', d.updated_at)), '[]'::jsonb)
                FROM public.device_tokens d WHERE d.user_id = u.id),
    'pro', jsonb_build_object('active', public.user_has_coach_pro(u.id),
      'subscriptions', (SELECT coalesce(jsonb_agg(s ORDER BY s.updated_at DESC), '[]'::jsonb) FROM public.app_store_subscriptions s WHERE s.user_id = u.id),
      'grants', (SELECT coalesce(jsonb_agg(g ORDER BY g.created_at DESC), '[]'::jsonb) FROM public.pro_grants g WHERE g.user_id = u.id)),
    'reports_filed', (SELECT count(*) FROM public.content_reports r WHERE r.reporter_id = u.id),
    'reports_about', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'reason', r.reason,
                        'resolution', r.resolution, 'created_at', r.created_at) ORDER BY r.created_at DESC), '[]'::jsonb)
                      FROM public.content_reports r WHERE r.author_id = u.id),
    'blocks', jsonb_build_object(
      'blocking', (SELECT count(*) FROM public.user_blocks b WHERE b.blocker_id = u.id),
      'blocked_by', (SELECT count(*) FROM public.user_blocks b WHERE b.blocked_id = u.id)),
    'deletion', (SELECT to_jsonb(d) - 'email' FROM public.account_deletions d WHERE d.user_id = u.id),
    'activity', jsonb_build_object(
      'active_days_30d', (SELECT count(*) FROM public.user_activity_days a WHERE a.user_id = u.id AND a.day > current_date - 30),
      'recent_events', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
          SELECT e.name, e.source, e.team_id, e.app_version, e.created_at FROM public.usage_events e
          WHERE e.user_id = u.id ORDER BY e.created_at DESC LIMIT 40) x)),
    'audit', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
        SELECT l.id, l.action, l.metadata, l.created_at, a.email AS actor_email
        FROM public.audit_logs l LEFT JOIN auth.users a ON a.id = l.actor_user_id
        WHERE l.target_id = u.id ORDER BY l.created_at DESC LIMIT 50) x)
  );
END $$;

-- Read-only "view as": what this person sees, minus every chat. The view itself is audited,
-- so this function is VOLATILE.
CREATE OR REPLACE FUNCTION public.admin_view_as(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  team_ids uuid[];
  kid_ids uuid[];
BEGIN
  PERFORM private.require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
    VALUES (auth.uid(), 'admin.view_as', 'auth.users', _user_id, '{}'::jsonb);

  SELECT array_agg(DISTINCT pl.id) INTO kid_ids FROM public.parent_player_links l JOIN public.players pl ON pl.id = l.player_id
    WHERE l.parent_user_id = _user_id AND pl.archived_at IS NULL;
  SELECT array_agg(DISTINCT x) INTO team_ids FROM (
    SELECT ur.team_id AS x FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.team_id IS NOT NULL
    UNION SELECT t.id FROM public.user_roles ur JOIN public.teams t ON t.org_id = ur.org_id
      WHERE ur.user_id = _user_id AND ur.team_id IS NULL AND ur.role = 'program_director'
    UNION SELECT pl.team_id FROM public.players pl WHERE pl.id = ANY(coalesce(kid_ids, '{}'))
    UNION SELECT pl.team_id FROM public.players pl WHERE pl.user_id = _user_id AND pl.archived_at IS NULL) s;

  RETURN jsonb_build_object(
    'teams', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'sport', t.sport,
                'is_pro', public.team_is_pro(t.id),
                'roles', (SELECT array_agg(DISTINCT ur.role::text) FROM public.user_roles ur WHERE ur.user_id = _user_id
                          AND (ur.team_id = t.id OR (ur.team_id IS NULL AND ur.org_id = t.org_id))))), '[]'::jsonb)
              FROM public.teams t WHERE t.id = ANY(coalesce(team_ids, '{}')) AND t.archived_at IS NULL),
    'children', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.first_name || ' ' || pl.last_name, 'team_id', pl.team_id)), '[]'::jsonb)
                 FROM public.players pl WHERE pl.id = ANY(coalesce(kid_ids, '{}'))),
    'upcoming', (SELECT coalesce(jsonb_agg(x ORDER BY x.starts_at), '[]'::jsonb) FROM (
        SELECT e.id, e.team_id, e.title, e.event_type, e.starts_at, e.location, e.cancelled_at,
          (SELECT coalesce(jsonb_agg(jsonb_build_object('player_id', r.player_id, 'status', r.status)), '[]'::jsonb)
             FROM public.rsvps r WHERE r.event_id = e.id
               AND (r.player_id = ANY(coalesce(kid_ids, '{}'))
                    OR r.player_id IN (SELECT pl.id FROM public.players pl WHERE pl.user_id = _user_id))) AS my_rsvps
        FROM public.events e WHERE e.team_id = ANY(coalesce(team_ids, '{}'))
          AND e.starts_at BETWEEN now() - interval '1 day' AND now() + interval '21 days'
        ORDER BY e.starts_at LIMIT 60) x),
    'dues_owed', (SELECT coalesce(jsonb_agg(jsonb_build_object('title', r.title, 'amount_cents', i.amount_cents, 'status', i.status,
                    'player_id', i.player_id, 'due_date', r.due_date)), '[]'::jsonb)
                  FROM public.dues_items i JOIN public.dues_requests r ON r.id = i.request_id
                  WHERE i.player_id = ANY(coalesce(kid_ids, '{}')) AND i.status IN ('unpaid','processing') AND r.archived_at IS NULL),
    -- Subjects only: bodies of chat notifications are message previews.
    'inbox', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
        SELECT n.kind, n.subject, n.team_id, s.created_at, s.read_at IS NOT NULL AS is_read
        FROM public.notification_sends s JOIN public.notifications n ON n.id = s.notification_id
        WHERE s.recipient_user_id = _user_id ORDER BY s.created_at DESC LIMIT 25) x)
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_reports(_status text DEFAULT 'open')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.require_platform_admin();
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x.created_at) FROM (
      SELECT r.id, r.kind, r.reason, r.note, r.status, r.resolution, r.resolution_note, r.resolved_at, r.created_at,
        r.snapshot_body, r.snapshot_image_path IS NOT NULL AS has_photo, r.snapshot_author_name, r.snapshot_thread_title,
        r.team_id, t.name AS team_name, r.author_id, au.email AS author_email, r.reporter_id, ru.email AS reporter_email,
        r.message_id, (SELECT m.deleted_at FROM public.messages m WHERE m.id = r.message_id) AS message_deleted_at,
        (SELECT count(*) FROM public.content_reports o WHERE o.author_id = r.author_id AND r.author_id IS NOT NULL) AS author_report_count,
        (SELECT p.suspended_at FROM public.profiles p WHERE p.id = r.author_id) AS author_suspended_at
      FROM public.content_reports r
      LEFT JOIN public.teams t ON t.id = r.team_id
      LEFT JOIN auth.users au ON au.id = r.author_id
      LEFT JOIN auth.users ru ON ru.id = r.reporter_id
      WHERE _status = 'all' OR r.status = _status
      ORDER BY r.created_at DESC LIMIT 200) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_grants()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.require_platform_admin();
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x.live DESC, x.created_at DESC) FROM (
      SELECT g.*, private.grant_is_live(g) AS live,
        CASE WHEN g.user_id IS NOT NULL THEN 'user' WHEN g.team_id IS NOT NULL THEN 'team' ELSE 'org' END AS target_type,
        coalesce((SELECT u.email FROM auth.users u WHERE u.id = g.user_id),
                 (SELECT t.name FROM public.teams t WHERE t.id = g.team_id),
                 (SELECT o.name FROM public.organizations o WHERE o.id = g.org_id)) AS target_name,
        (SELECT u.email FROM auth.users u WHERE u.id = g.created_by) AS created_by_email
      FROM public.pro_grants g ORDER BY g.created_at DESC LIMIT 300) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_revenue()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.require_platform_admin();
  RETURN jsonb_build_object(
    'subscriptions', (SELECT coalesce(jsonb_agg(x ORDER BY x.updated_at DESC), '[]'::jsonb) FROM (
        SELECT s.original_transaction_id, s.user_id, u.email, s.product_id, s.status, s.expires_at, s.auto_renew,
          s.in_trial, s.environment, s.created_at, s.updated_at
        FROM public.app_store_subscriptions s LEFT JOIN auth.users u ON u.id = s.user_id) x),
    'events', (SELECT coalesce(jsonb_agg(x ORDER BY x.received_at DESC), '[]'::jsonb) FROM (
        SELECT e.notification_type, e.subtype, e.product_id, e.environment, e.received_at, e.user_id, u.email
        FROM public.app_store_events e LEFT JOIN auth.users u ON u.id = e.user_id
        ORDER BY e.received_at DESC LIMIT 100) x)
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_audit(_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.require_platform_admin();
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT l.id, l.action, l.target_table, l.target_id, l.team_id, l.metadata, l.created_at, u.email AS actor_email
      FROM public.audit_logs l LEFT JOIN auth.users u ON u.id = l.actor_user_id
      WHERE l.action LIKE 'admin.%'
      ORDER BY l.created_at DESC LIMIT least(greatest(_limit, 1), 1000)) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_admins()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.require_platform_admin();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'email', a.email, 'role', a.role, 'claimed', a.user_id IS NOT NULL,
            'created_at', a.created_at, 'removed_at', a.removed_at) ORDER BY a.created_at)
          FROM public.platform_admins a), '[]'::jsonb);
END $$;

-- Broadcast audiences. Segment: {"kind": all|coaches|head_coaches|parents|players|pro_coaches|team|org, "id": uuid}.
-- Suspended accounts never receive broadcasts.
CREATE OR REPLACE FUNCTION public.admin_segment_users(_segment jsonb)
RETURNS TABLE (user_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k text := _segment ->> 'kind';
  sid uuid := nullif(_segment ->> 'id', '')::uuid;
BEGIN
  PERFORM private.require_platform_admin();
  RETURN QUERY
  SELECT DISTINCT s.uid FROM (
    SELECT u.id AS uid FROM auth.users u WHERE k = 'all'
    UNION SELECT ur.user_id FROM public.user_roles ur WHERE k = 'coaches' AND ur.role IN ('head_coach','assistant_coach','team_manager','program_director')
    UNION SELECT ur.user_id FROM public.user_roles ur WHERE k = 'head_coaches' AND ur.role = 'head_coach'
    UNION SELECT l.parent_user_id FROM public.parent_player_links l WHERE k = 'parents'
    UNION SELECT pl.user_id FROM public.players pl WHERE k = 'players' AND pl.user_id IS NOT NULL
    UNION SELECT ur.user_id FROM public.user_roles ur WHERE k = 'pro_coaches' AND ur.role = 'head_coach' AND public.user_has_coach_pro(ur.user_id)
    UNION SELECT ur.user_id FROM public.user_roles ur WHERE k = 'team' AND ur.team_id = sid
    UNION SELECT l.parent_user_id FROM public.parent_player_links l JOIN public.players pl ON pl.id = l.player_id WHERE k = 'team' AND pl.team_id = sid
    UNION SELECT pl.user_id FROM public.players pl WHERE k = 'team' AND pl.team_id = sid AND pl.user_id IS NOT NULL
    UNION SELECT ur.user_id FROM public.user_roles ur JOIN public.teams t ON t.id = ur.team_id WHERE k = 'org' AND t.org_id = sid
    UNION SELECT ur.user_id FROM public.user_roles ur WHERE k = 'org' AND ur.org_id = sid AND ur.team_id IS NULL
    UNION SELECT l.parent_user_id FROM public.parent_player_links l JOIN public.players pl ON pl.id = l.player_id
      JOIN public.teams t ON t.id = pl.team_id WHERE k = 'org' AND t.org_id = sid
  ) s
  JOIN auth.users u ON u.id = s.uid
  LEFT JOIN public.profiles p ON p.id = s.uid
  WHERE s.uid IS NOT NULL AND p.suspended_at IS NULL AND u.email NOT ILIKE '%.invalid';
END $$;

CREATE OR REPLACE FUNCTION public.admin_broadcast_preview(_segment jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.require_platform_admin();
  RETURN jsonb_build_object(
    'recipients', (SELECT count(*) FROM public.admin_segment_users(_segment)),
    'with_devices', (SELECT count(DISTINCT d.user_id) FROM public.device_tokens d WHERE d.user_id IN (SELECT s.user_id FROM public.admin_segment_users(_segment) s)),
    'history', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
        SELECT b.id, b.title, b.body, b.segment, b.is_test, b.recipients, b.with_devices, b.delivered, b.created_at, u.email AS sent_by_email
        FROM public.admin_broadcasts b LEFT JOIN auth.users u ON u.id = b.sent_by ORDER BY b.created_at DESC LIMIT 30) x));
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_whoami()', 'admin_overview()', 'admin_teams()', 'admin_team(uuid)', 'admin_search_users(text)',
    'admin_user(uuid)', 'admin_view_as(uuid)', 'admin_reports(text)', 'admin_grants()', 'admin_revenue()',
    'admin_audit(integer)', 'admin_admins()', 'admin_segment_users(jsonb)', 'admin_broadcast_preview(jsonb)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 10. Grants. New tables are written only by Edge Functions (service role).
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.user_blocks TO authenticated;
GRANT ALL ON public.platform_admins, public.content_reports, public.user_blocks, public.pro_grants, public.usage_events,
  public.user_activity_days, public.app_store_events, public.account_deletions, public.admin_broadcasts,
  public.admin_push_subscriptions TO service_role;

-- Bootstrap the owner (claimed at first portal sign-in with this confirmed email).
INSERT INTO public.platform_admins (email, role) VALUES ('dguilloryjr@gmail.com', 'owner') ON CONFLICT (email) DO NOTHING;
