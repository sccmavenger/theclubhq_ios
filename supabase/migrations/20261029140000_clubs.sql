-- Clubs Phase 1 (DECISIONS D-044, docs/CLUBS.md). Additive only (D-003).

-- ---------------------------------------------------------------------------
-- 1. Grouping and branding
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS grade text CHECK (grade IS NULL OR char_length(grade) <= 20);
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS gender text CHECK (gender IS NULL OR gender IN ('boys', 'girls', 'coed'));
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS level text CHECK (level IS NULL OR char_length(level) <= 40);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS brand_color text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS time_zone text;

-- Club announcements land on each team, labeled with the club (owner decision 7).
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS from_club text CHECK (from_club IS NULL OR char_length(from_club) <= 120);
-- Club events: one per team, linked so they can be cancelled together.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS club_event_id uuid;
CREATE INDEX IF NOT EXISTS events_club_event_idx ON public.events(club_event_id) WHERE club_event_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Club invites: the club code (coaches bring or start a team) and per-team coach invites
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('club_code', 'coach')),
  token text NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 8 AND 64),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'head_coach',
  email text CHECK (email IS NULL OR char_length(email) <= 254),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '365 days',
  revoked_at timestamptz,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  CHECK ((kind = 'coach') = (team_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS club_invites_org_idx ON public.club_invites(org_id);
ALTER TABLE public.club_invites ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Directors manage every team in their club (owner decision 4)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.can_manage_team(_user_id uuid, _team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT private.has_team_role(_user_id, _team_id, 'head_coach')
    OR EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = _team_id AND private.has_org_role(_user_id, t.org_id, 'program_director')
    );
$function$;
REVOKE ALL ON FUNCTION private.can_manage_team(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_team(uuid, uuid) TO authenticated;

-- Every policy that allowed the team's head coach now also allows the club's directors.
-- (Generated from the live policies on 2026-10-29: has_team_role(..., 'head_coach') → can_manage_team.)
ALTER POLICY "Head coach deletes announcements" ON public.announcements
  USING (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach edits announcements" ON public.announcements
  USING (private.can_manage_team(auth.uid(), team_id))
  WITH CHECK (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach writes announcements" ON public.announcements
  WITH CHECK (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach marks attendance" ON public.attendance
  WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = attendance.event_id) AND private.can_manage_team(auth.uid(), e.team_id)))));

ALTER POLICY "Head coach updates attendance" ON public.attendance
  USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = attendance.event_id) AND private.can_manage_team(auth.uid(), e.team_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = attendance.event_id) AND private.can_manage_team(auth.uid(), e.team_id)))));

ALTER POLICY "audit_read_team_admins" ON public.audit_logs
  USING (((team_id IS NOT NULL) AND (private.can_manage_team(auth.uid(), team_id) OR private.has_role(auth.uid(), 'super_admin'::app_role))));

ALTER POLICY "Staff read team dues items" ON public.dues_items
  USING ((EXISTS ( SELECT 1
   FROM dues_requests r
  WHERE ((r.id = dues_items.request_id) AND (private.can_manage_team(auth.uid(), r.team_id) OR private.has_team_role(auth.uid(), r.team_id, 'assistant_coach'::app_role) OR private.has_team_role(auth.uid(), r.team_id, 'team_manager'::app_role))))));

ALTER POLICY "Uploader or head coach deletes event photo" ON public.event_photos
  USING (((uploaded_by = auth.uid()) OR private.can_manage_team(auth.uid(), team_id)));

ALTER POLICY "Head coach creates signup slots" ON public.event_signup_slots
  WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_signup_slots.event_id) AND private.can_manage_team(auth.uid(), e.team_id)))));

ALTER POLICY "Head coach deletes signup slots" ON public.event_signup_slots
  USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_signup_slots.event_id) AND private.can_manage_team(auth.uid(), e.team_id)))));

ALTER POLICY "Head coach updates signup slots" ON public.event_signup_slots
  USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_signup_slots.event_id) AND private.can_manage_team(auth.uid(), e.team_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_signup_slots.event_id) AND private.can_manage_team(auth.uid(), e.team_id)))));

ALTER POLICY "Head coach creates events" ON public.events
  WITH CHECK (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach deletes events" ON public.events
  USING (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach updates events" ON public.events
  USING (private.can_manage_team(auth.uid(), team_id))
  WITH CHECK (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "staff create threads" ON public.message_threads
  WITH CHECK (((created_by = auth.uid()) AND (private.can_manage_team(auth.uid(), team_id) OR private.has_team_role(auth.uid(), team_id, 'assistant_coach'::app_role) OR private.has_team_role(auth.uid(), team_id, 'team_manager'::app_role) OR (EXISTS ( SELECT 1
   FROM teams t
  WHERE ((t.id = message_threads.team_id) AND private.has_org_role(auth.uid(), t.org_id, 'program_director'::app_role)))) OR private.has_role(auth.uid(), 'super_admin'::app_role))));

ALTER POLICY "staff update own threads" ON public.message_threads
  USING ((private.can_manage_team(auth.uid(), team_id) OR (EXISTS ( SELECT 1
   FROM teams t
  WHERE ((t.id = message_threads.team_id) AND private.has_org_role(auth.uid(), t.org_id, 'program_director'::app_role)))) OR private.has_role(auth.uid(), 'super_admin'::app_role) OR (created_by = auth.uid())));

ALTER POLICY "staff moderate messages" ON public.messages
  USING ((EXISTS ( SELECT 1
   FROM message_threads t
  WHERE ((t.id = messages.thread_id) AND (private.can_manage_team(auth.uid(), t.team_id) OR (EXISTS ( SELECT 1
           FROM teams tt
          WHERE ((tt.id = t.team_id) AND private.has_org_role(auth.uid(), tt.org_id, 'program_director'::app_role)))) OR private.has_role(auth.uid(), 'super_admin'::app_role))))));

ALTER POLICY "Recipient reads own sends" ON public.notification_sends
  USING (((recipient_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM notifications n
  WHERE ((n.id = notification_sends.notification_id) AND private.can_manage_team(auth.uid(), n.team_id))))));

ALTER POLICY "Coach reads team notifications" ON public.notifications
  USING (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach deletes players" ON public.players
  USING (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach manages players" ON public.players
  WITH CHECK (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach updates players" ON public.players
  USING (private.can_manage_team(auth.uid(), team_id))
  WITH CHECK (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Parent updates own rsvp" ON public.rsvps
  USING (((EXISTS ( SELECT 1
   FROM parent_player_links l
  WHERE ((l.player_id = rsvps.player_id) AND (l.parent_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM players p
  WHERE ((p.id = rsvps.player_id) AND private.can_manage_team(auth.uid(), p.team_id))))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM parent_player_links l
  WHERE ((l.player_id = rsvps.player_id) AND (l.parent_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM players p
  WHERE ((p.id = rsvps.player_id) AND private.can_manage_team(auth.uid(), p.team_id))))));

ALTER POLICY "Parent writes own rsvp" ON public.rsvps
  WITH CHECK (((EXISTS ( SELECT 1
   FROM parent_player_links l
  WHERE ((l.player_id = rsvps.player_id) AND (l.parent_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM players p
  WHERE ((p.id = rsvps.player_id) AND private.can_manage_team(auth.uid(), p.team_id))))));

ALTER POLICY "Head coach creates invites" ON public.team_invites
  WITH CHECK (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach reads invites" ON public.team_invites
  USING (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach updates invites" ON public.team_invites
  USING (private.can_manage_team(auth.uid(), team_id))
  WITH CHECK (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach reads payment account" ON public.team_payment_accounts
  USING (private.can_manage_team(auth.uid(), team_id));

ALTER POLICY "Head coach updates team" ON public.teams
  USING (private.can_manage_team(auth.uid(), id))
  WITH CHECK (private.can_manage_team(auth.uid(), id));
