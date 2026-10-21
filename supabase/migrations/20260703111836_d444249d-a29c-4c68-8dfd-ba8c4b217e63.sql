
-- ============ SLICE 2-6 SCHEMA ============

-- Players
CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  jersey_number text,
  position text,
  birthdate date,
  notes text,
  archived_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.players TO authenticated;
GRANT ALL ON public.players TO service_role;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members read players" ON public.players FOR SELECT TO authenticated
  USING (public.can_access_team(auth.uid(), team_id));
CREATE POLICY "Head coach manages players" ON public.players FOR INSERT TO authenticated
  WITH CHECK (public.has_team_role(auth.uid(), team_id, 'head_coach'));
CREATE POLICY "Head coach updates players" ON public.players FOR UPDATE TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'head_coach'))
  WITH CHECK (public.has_team_role(auth.uid(), team_id, 'head_coach'));
CREATE POLICY "Head coach deletes players" ON public.players FOR DELETE TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'head_coach'));

CREATE TRIGGER players_updated BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Parent-player links
CREATE TABLE public.parent_player_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  parent_user_id uuid NOT NULL,
  relationship text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, parent_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parent_player_links TO authenticated;
GRANT ALL ON public.parent_player_links TO service_role;
ALTER TABLE public.parent_player_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parent reads own links" ON public.parent_player_links FOR SELECT TO authenticated
  USING (parent_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.players p WHERE p.id = player_id
      AND public.has_team_role(auth.uid(), p.team_id, 'head_coach')));
CREATE POLICY "Parent creates own link" ON public.parent_player_links FOR INSERT TO authenticated
  WITH CHECK (parent_user_id = auth.uid());
CREATE POLICY "Parent removes own link" ON public.parent_player_links FOR DELETE TO authenticated
  USING (parent_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.players p WHERE p.id = player_id
      AND public.has_team_role(auth.uid(), p.team_id, 'head_coach')));

-- Helper: parent can access team if they have a linked player on the team
CREATE OR REPLACE FUNCTION public.parent_can_read_team(_user_id uuid, _team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.parent_player_links l
    JOIN public.players p ON p.id = l.player_id
    WHERE l.parent_user_id = _user_id AND p.team_id = _team_id
  );
$$;

-- Extend team read policy for parents (add a second SELECT policy - OR semantics)
CREATE POLICY "Parents read linked team" ON public.teams FOR SELECT TO authenticated
  USING (public.parent_can_read_team(auth.uid(), id));
CREATE POLICY "Parents read linked players" ON public.players FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.parent_player_links l
    WHERE l.player_id = players.id AND l.parent_user_id = auth.uid()));

-- Team invites (rotating opaque token)
CREATE TABLE public.team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_invites TO authenticated;
GRANT ALL ON public.team_invites TO service_role;
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Head coach reads invites" ON public.team_invites FOR SELECT TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'head_coach'));
CREATE POLICY "Head coach creates invites" ON public.team_invites FOR INSERT TO authenticated
  WITH CHECK (public.has_team_role(auth.uid(), team_id, 'head_coach'));
CREATE POLICY "Head coach updates invites" ON public.team_invites FOR UPDATE TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'head_coach'))
  WITH CHECK (public.has_team_role(auth.uid(), team_id, 'head_coach'));

-- Events
CREATE TYPE public.event_type AS ENUM ('practice','game','other');
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  title text NOT NULL,
  event_type public.event_type NOT NULL DEFAULT 'practice',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location text,
  notes text,
  cancelled_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members read events" ON public.events FOR SELECT TO authenticated
  USING (public.can_access_team(auth.uid(), team_id) OR public.parent_can_read_team(auth.uid(), team_id));
CREATE POLICY "Head coach creates events" ON public.events FOR INSERT TO authenticated
  WITH CHECK (public.has_team_role(auth.uid(), team_id, 'head_coach'));
CREATE POLICY "Head coach updates events" ON public.events FOR UPDATE TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'head_coach'))
  WITH CHECK (public.has_team_role(auth.uid(), team_id, 'head_coach'));
CREATE POLICY "Head coach deletes events" ON public.events FOR DELETE TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'head_coach'));

CREATE TRIGGER events_updated BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- RSVPs
CREATE TYPE public.rsvp_status AS ENUM ('yes','no','maybe');
CREATE TABLE public.rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  status public.rsvp_status NOT NULL,
  responded_by uuid NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, player_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rsvps TO authenticated;
GRANT ALL ON public.rsvps TO service_role;
ALTER TABLE public.rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team + parent read rsvps" ON public.rsvps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND (
    public.can_access_team(auth.uid(), e.team_id) OR public.parent_can_read_team(auth.uid(), e.team_id)
  )));
CREATE POLICY "Parent writes own rsvp" ON public.rsvps FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.parent_player_links l WHERE l.player_id = rsvps.player_id AND l.parent_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.players p WHERE p.id = rsvps.player_id AND public.has_team_role(auth.uid(), p.team_id, 'head_coach'))
  );
CREATE POLICY "Parent updates own rsvp" ON public.rsvps FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.parent_player_links l WHERE l.player_id = rsvps.player_id AND l.parent_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.players p WHERE p.id = rsvps.player_id AND public.has_team_role(auth.uid(), p.team_id, 'head_coach'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.parent_player_links l WHERE l.player_id = rsvps.player_id AND l.parent_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.players p WHERE p.id = rsvps.player_id AND public.has_team_role(auth.uid(), p.team_id, 'head_coach'))
  );

CREATE TRIGGER rsvps_updated BEFORE UPDATE ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Attendance
CREATE TYPE public.attendance_status AS ENUM ('present','absent','late','excused');
CREATE TABLE public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  status public.attendance_status NOT NULL,
  marked_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, player_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team + parent read attendance" ON public.attendance FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND (
    public.can_access_team(auth.uid(), e.team_id)
    OR EXISTS (SELECT 1 FROM public.parent_player_links l WHERE l.player_id = attendance.player_id AND l.parent_user_id = auth.uid())
  )));
CREATE POLICY "Head coach marks attendance" ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND public.has_team_role(auth.uid(), e.team_id, 'head_coach')));
CREATE POLICY "Head coach updates attendance" ON public.attendance FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND public.has_team_role(auth.uid(), e.team_id, 'head_coach')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND public.has_team_role(auth.uid(), e.team_id, 'head_coach')));

CREATE TRIGGER attendance_updated BEFORE UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Announcements
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team + parent read announcements" ON public.announcements FOR SELECT TO authenticated
  USING (public.can_access_team(auth.uid(), team_id) OR public.parent_can_read_team(auth.uid(), team_id));
CREATE POLICY "Head coach writes announcements" ON public.announcements FOR INSERT TO authenticated
  WITH CHECK (public.has_team_role(auth.uid(), team_id, 'head_coach'));
CREATE POLICY "Head coach edits announcements" ON public.announcements FOR UPDATE TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'head_coach'))
  WITH CHECK (public.has_team_role(auth.uid(), team_id, 'head_coach'));
CREATE POLICY "Head coach deletes announcements" ON public.announcements FOR DELETE TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'head_coach'));

CREATE TRIGGER announcements_updated BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Notifications queue + sends (Slice 6)
CREATE TYPE public.notification_kind AS ENUM ('announcement','event_created','event_updated','event_reminder','rsvp_reminder');
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  kind public.notification_kind NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  ref_id uuid,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coach reads team notifications" ON public.notifications FOR SELECT TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'head_coach'));

CREATE TABLE public.notification_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.notification_sends TO authenticated;
GRANT ALL ON public.notification_sends TO service_role;
ALTER TABLE public.notification_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recipient reads own sends" ON public.notification_sends FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.notifications n
      WHERE n.id = notification_id AND public.has_team_role(auth.uid(), n.team_id, 'head_coach')));
