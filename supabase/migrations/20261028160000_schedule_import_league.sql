-- CNR league schedules as an import source (DECISIONS D-043). Additive only (D-003).
ALTER TABLE public.schedule_imports DROP CONSTRAINT IF EXISTS schedule_imports_source_kind_check;
ALTER TABLE public.schedule_imports ADD CONSTRAINT schedule_imports_source_kind_check
  CHECK (source_kind IN ('google_sheet', 'cnr_league'));
