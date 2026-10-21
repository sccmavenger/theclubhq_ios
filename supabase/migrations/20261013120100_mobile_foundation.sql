-- ClubHQ iOS v1 — step 2 of 2.
-- Additive only (DECISIONS D-003). Every new table has RLS enabled. Writes to the
-- money / entitlement tables happen exclusively through Edge Functions using the
-- service role, so those tables expose SELECT policies only.

-- ---------------------------------------------------------------------------
-- 1. Multi-sport teams (D-013)
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'basketball';
DO $$ BEGIN
  ALTER TABLE public.teams ADD CONSTRAINT teams_sport_check CHECK (sport IN (
    'basketball','soccer','baseball','softball','volleyball','football','hockey','lacrosse','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Optional brand color (Coach Pro), hex like '#1F6FEB'.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS brand_color text;

-- ---------------------------------------------------------------------------
-- 2. Player accounts (D-007, D-008)
-- ---------------------------------------------------------------------------
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS players_user_team_unique ON public.players(user_id, team_id) WHERE user_id IS NOT NULL;

-- Single-use code a guardian or head coach generates so a 13+ player can claim
-- their roster entry with their own login. Claimed only via mobile-api.
CREATE TABLE IF NOT EXISTS public.player_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  claimed_at timestamptz,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.player_invites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Creator reads own player invites" ON public.player_invites
    FOR SELECT TO authenticated USING (created_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A player can read their own roster row (team-wide read is already granted by
-- "Team members read players" through their `player` user_role).
DO $$ BEGIN
  CREATE POLICY "Player reads own player row" ON public.players
    FOR SELECT TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Players RSVP for themselves.
DO $$ BEGIN
  CREATE POLICY "Player writes own rsvp" ON public.rsvps FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.players p WHERE p.id = rsvps.player_id AND p.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Player updates own rsvp" ON public.rsvps FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.players p WHERE p.id = rsvps.player_id AND p.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.players p WHERE p.id = rsvps.player_id AND p.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Players see team-wide ('both') threads only — never parents-only or staff-only
-- threads, and never direct/group threads unless explicitly a participant (the
-- app and mobile-api never add players to direct/group threads: D-009).
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
        OR EXISTS (
          SELECT 1 FROM public.teams t
          WHERE t.id = _team_id AND private.has_org_role(_user_id, t.org_id, 'program_director')
        )
        OR private.has_role(_user_id, 'super_admin')
      ) THEN true
      WHEN _audience IN ('parents','both') AND private.parent_can_read_team(_user_id, _team_id) THEN true
      WHEN _audience = 'both' AND private.has_team_role(_user_id, _team_id, 'player') THEN true
      ELSE false
    END;
$function$;
REVOKE ALL ON FUNCTION private.can_read_thread(uuid, uuid, message_audience) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. APNs device tokens (D-012) — own rows only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios')),
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON public.device_tokens(user_id);
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own device tokens select" ON public.device_tokens FOR SELECT TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "own device tokens insert" ON public.device_tokens FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "own device tokens update" ON public.device_tokens FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "own device tokens delete" ON public.device_tokens FOR DELETE TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- APNs dispatch bookkeeping (D-021). NULL = not yet pushed to iOS devices.
ALTER TABLE public.notification_sends ADD COLUMN IF NOT EXISTS apns_sent_at timestamptz;
CREATE INDEX IF NOT EXISTS notification_sends_apns_pending_idx
  ON public.notification_sends(created_at) WHERE apns_sent_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Coach Pro subscriptions (D-010, D-011)
-- Source of truth: App Store Server Notifications v2 + client-forwarded signed
-- transactions, both verified in Edge Functions. Read-only to the owner.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_store_subscriptions (
  original_transaction_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','grace_period','billing_retry','expired','revoked')),
  expires_at timestamptz,
  environment text NOT NULL DEFAULT 'Production',
  auto_renew boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_store_subscriptions_user_idx ON public.app_store_subscriptions(user_id);
ALTER TABLE public.app_store_subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own subscriptions select" ON public.app_store_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Is this user entitled to Coach Pro right now?
CREATE OR REPLACE FUNCTION public.user_has_coach_pro(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_store_subscriptions s
    WHERE s.user_id = _user_id
      AND s.status IN ('active','grace_period','billing_retry')
      AND (s.expires_at IS NULL OR s.expires_at > now() - interval '3 days')
  );
$$;
REVOKE ALL ON FUNCTION public.user_has_coach_pro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_coach_pro(uuid) TO authenticated, service_role;

-- A team is "Pro" when any of its head coaches holds Coach Pro.
CREATE OR REPLACE FUNCTION public.team_is_pro(_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.team_id = _team_id AND ur.role = 'head_coach' AND public.user_has_coach_pro(ur.user_id)
  );
$$;
REVOKE ALL ON FUNCTION public.team_is_pro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_is_pro(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Team dues via Stripe Connect (D-010, D-011)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_payment_accounts (
  team_id uuid PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  stripe_account_id text NOT NULL UNIQUE,
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_payment_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Head coach reads payment account" ON public.team_payment_accounts FOR SELECT TO authenticated
    USING (private.has_team_role(auth.uid(), team_id, 'head_coach'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.dues_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 500000),
  due_date date,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS dues_requests_team_idx ON public.dues_requests(team_id);
ALTER TABLE public.dues_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Team members read dues requests" ON public.dues_requests FOR SELECT TO authenticated
    USING (private.can_access_team(auth.uid(), team_id) OR private.parent_can_read_team(auth.uid(), team_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One line per player per request.
CREATE TABLE IF NOT EXISTS public.dues_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.dues_requests(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','processing','paid','waived')),
  paid_at timestamptz,
  paid_by uuid REFERENCES auth.users(id),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  fee_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, player_id)
);
CREATE INDEX IF NOT EXISTS dues_items_player_idx ON public.dues_items(player_id);
ALTER TABLE public.dues_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Staff read team dues items" ON public.dues_items FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.dues_requests r
      WHERE r.id = request_id AND (
        private.has_team_role(auth.uid(), r.team_id, 'head_coach')
        OR private.has_team_role(auth.uid(), r.team_id, 'assistant_coach')
        OR private.has_team_role(auth.uid(), r.team_id, 'team_manager'))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Guardians read own kids dues items" ON public.dues_items FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.parent_player_links l WHERE l.player_id = dues_items.player_id AND l.parent_user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 6. Team sponsors (D-010) — sold on the web, displayed in-app, no tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  tagline text CHECK (tagline IS NULL OR char_length(tagline) <= 140),
  logo_url text,
  link_url text,
  starts_on date NOT NULL DEFAULT current_date,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_sponsors_team_idx ON public.team_sponsors(team_id);
ALTER TABLE public.team_sponsors ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Team members read sponsors" ON public.team_sponsors FOR SELECT TO authenticated
    USING (private.can_access_team(auth.uid(), team_id) OR private.parent_can_read_team(auth.uid(), team_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 7. Grants (Supabase exposes tables to `authenticated` via PostgREST)
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.player_invites, public.app_store_subscriptions, public.team_payment_accounts,
  public.dues_requests, public.dues_items, public.team_sponsors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;
GRANT ALL ON public.player_invites, public.device_tokens, public.app_store_subscriptions,
  public.team_payment_accounts, public.dues_requests, public.dues_items, public.team_sponsors TO service_role;
