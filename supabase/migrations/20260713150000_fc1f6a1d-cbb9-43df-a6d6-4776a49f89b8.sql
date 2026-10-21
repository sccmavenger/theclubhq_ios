-- US-012 (part 1 of 2): add the 'direct' and 'group' values to thread_kind.
-- Postgres forbids USING a newly-added enum value in the same transaction it is
-- added, and Supabase runs each migration file in its own transaction, so this
-- file adds the values ONLY. The companion migration 20260713150100 (which runs
-- after this one commits) references them and adds the participant schema/policies.
ALTER TYPE public.thread_kind ADD VALUE IF NOT EXISTS 'direct';
ALTER TYPE public.thread_kind ADD VALUE IF NOT EXISTS 'group';
