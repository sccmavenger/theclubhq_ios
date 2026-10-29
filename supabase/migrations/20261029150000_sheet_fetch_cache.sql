-- Short-lived cache of fetched Google Sheets (D-042): preview → import reads Google once.
-- Rows older than 2 minutes are ignored and overwritten; cleaned daily by scheduled-jobs.
CREATE TABLE IF NOT EXISTS public.sheet_fetch_cache (
  url text PRIMARY KEY,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);
ALTER TABLE public.sheet_fetch_cache ENABLE ROW LEVEL SECURITY;
