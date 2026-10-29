-- Event reminders and RSVP nudges (DECISIONS D-045). Additive only (D-003).

-- One row per (event, reminder) that was sent; claimed before sending so runs never double-send.
CREATE TABLE IF NOT EXISTS public.event_reminder_log (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('day_before', 'two_hours', 'rsvp_nudge')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, kind)
);
ALTER TABLE public.event_reminder_log ENABLE ROW LEVEL SECURITY;

-- Per-person switches: {"event_reminders": false, "rsvp_reminders": false}. Missing = on.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
