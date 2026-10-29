-- Team deletion by coaches and club directors (DECISIONS D-046). Additive only (D-003).
-- A deleted team is archived at once (hidden everywhere). Only a platform admin can restore it,
-- and only within 30 days; after that scheduled-jobs deletes it and everything on it for good.

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS teams_deleted_idx ON public.teams(deleted_at) WHERE deleted_at IS NOT NULL;

-- Admin portal: show who deleted a team and when (the portal computes the 30-day deadline).
CREATE OR REPLACE FUNCTION public.admin_team(_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.teams;
BEGIN
  PERFORM private.require_platform_admin();
  SELECT * INTO t FROM public.teams WHERE id = _team_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object(
    'team', jsonb_build_object('id', t.id, 'name', t.name, 'sport', t.sport, 'age_group', t.age_group, 'season', t.season,
      'created_at', t.created_at, 'archived_at', t.archived_at, 'deleted_at', t.deleted_at, 'deleted_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = t.deleted_by), 'time_zone', t.time_zone, 'brand_color', t.brand_color,
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
END $function$;

CREATE OR REPLACE FUNCTION public.admin_teams()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM private.require_platform_admin();
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x.last_activity_at DESC NULLS LAST) FROM (
      SELECT t.id, t.name, t.sport, t.age_group, t.season, t.created_at, t.archived_at, t.deleted_at,
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
END $function$;
