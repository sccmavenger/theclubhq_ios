-- Tournament schedule import from a Google Sheets link (DECISIONS D-042). Additive only (D-003).
-- Writes go through mobile-api with the service role; members can read their team's imports.

-- ---------------------------------------------------------------------------
-- 1. One row per (team, sheet): which sheet team is ours, and when we last imported
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  source_kind text NOT NULL DEFAULT 'google_sheet' CHECK (source_kind IN ('google_sheet')),
  source_url text NOT NULL CHECK (char_length(source_url) <= 500),
  title text NOT NULL CHECK (char_length(title) <= 200),
  sheet_team_key text NOT NULL CHECK (char_length(sheet_team_key) <= 300),
  sheet_team_name text NOT NULL CHECK (char_length(sheet_team_name) <= 200),
  -- A bracket-tab name the coach said is theirs when it didn't connect on its own.
  sheet_alias text CHECK (sheet_alias IS NULL OR char_length(sheet_alias) <= 200),
  time_zone text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, source_url)
);
ALTER TABLE public.schedule_imports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Team members read schedule imports" ON public.schedule_imports FOR SELECT TO authenticated
    USING (private.can_access_team(auth.uid(), team_id) OR private.parent_can_read_team(auth.uid(), team_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Imported events remember where they came from, so re-importing updates instead of copying
-- ---------------------------------------------------------------------------
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES public.schedule_imports(id) ON DELETE SET NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS external_key text;
CREATE UNIQUE INDEX IF NOT EXISTS events_import_key_unique ON public.events(import_id, external_key) WHERE import_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. "This ClubHQ team is that sheet team" — remembered for the next tournament
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_team_aliases (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  alias text NOT NULL CHECK (char_length(alias) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, alias)
);
ALTER TABLE public.schedule_team_aliases ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. "Couldn't find my team" reports, so we learn which sheets the reader gets wrong
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_import_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_url text NOT NULL CHECK (char_length(source_url) <= 500),
  reason text NOT NULL CHECK (reason IN ('team_missing', 'games_wrong', 'unreadable', 'other')),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_import_reports_created_idx ON public.schedule_import_reports(created_at);
ALTER TABLE public.schedule_import_reports ENABLE ROW LEVEL SECURITY;
