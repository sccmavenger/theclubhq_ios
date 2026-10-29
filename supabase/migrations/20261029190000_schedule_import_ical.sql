-- Team calendar (.ics) feeds as an import source, re-checked automatically (DECISIONS D-047). Additive only (D-003).
ALTER TABLE public.schedule_imports DROP CONSTRAINT IF EXISTS schedule_imports_source_kind_check;
ALTER TABLE public.schedule_imports ADD CONSTRAINT schedule_imports_source_kind_check
  CHECK (source_kind IN ('google_sheet', 'cnr_league', 'ical'));

-- scheduled-jobs re-reads calendar imports every ~20 minutes and records how the last try went.
ALTER TABLE public.schedule_imports ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE public.schedule_imports ADD COLUMN IF NOT EXISTS check_error text CHECK (check_error IS NULL OR char_length(check_error) <= 500);
ALTER TABLE public.schedule_imports ADD COLUMN IF NOT EXISTS check_failures integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS schedule_imports_recheck_idx ON public.schedule_imports(last_checked_at NULLS FIRST) WHERE source_kind = 'ical';

-- Events the coach unticked in the review list, so re-checks don't bring them back.
ALTER TABLE public.schedule_imports ADD COLUMN IF NOT EXISTS skipped_keys text[] NOT NULL DEFAULT '{}';
