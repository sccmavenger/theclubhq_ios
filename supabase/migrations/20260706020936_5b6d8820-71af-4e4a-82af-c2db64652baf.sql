-- Full data purge. Schema, policies, functions, and triggers are untouched.
-- CASCADE handles FK dependencies; RESTART IDENTITY resets any sequences.
TRUNCATE TABLE
  public.announcement_reads,
  public.announcements,
  public.attendance,
  public.rsvps,
  public.events,
  public.message_reads,
  public.messages,
  public.message_threads,
  public.notification_sends,
  public.notifications,
  public.player_emergency_contacts,
  public.player_sensitive_fields,
  public.parent_player_links,
  public.players,
  public.team_invites,
  public.calendar_tokens,
  public.user_roles,
  public.teams,
  public.organizations,
  public.profiles,
  public.audit_logs
RESTART IDENTITY CASCADE;

-- Remove all authenticated users so a fresh sign-in triggers handle_new_user
-- and starts the onboarding flow from scratch.
DELETE FROM auth.users;