-- D-036: chat photos, calendar feeds, season-long team codes. Additive / relaxing only (D-003).

-- ============ Chat photos ============
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS image_width integer CHECK (image_width BETWEEN 1 AND 20000),
  ADD COLUMN IF NOT EXISTS image_height integer CHECK (image_height BETWEEN 1 AND 20000);

-- A photo message may have no caption; text-only messages still need 1-4000 characters.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_body_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_body_check
  CHECK (char_length(body) <= 4000 AND (char_length(body) >= 1 OR image_path IS NOT NULL));

-- Clients can also write messages through PostgREST (RLS), so the database itself makes sure
-- a message can only point at a photo its author uploaded for that thread, and that the
-- reference never changes afterwards. Otherwise list-messages could be tricked into signing
-- a URL for another team's photo.
CREATE OR REPLACE FUNCTION private.check_message_image_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _team uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.image_path IS DISTINCT FROM OLD.image_path THEN
    RAISE EXCEPTION 'image_path cannot be changed' USING ERRCODE = '42501';
  END IF;
  -- Checked on UPDATE too, so a photo message can't be moved into another thread.
  IF NEW.image_path IS NOT NULL THEN
    SELECT team_id INTO _team FROM public.message_threads WHERE id = NEW.thread_id;
    IF _team IS NULL OR NEW.image_path NOT LIKE (_team::text || '/' || NEW.thread_id::text || '/' || NEW.author_id::text || '/%') THEN
      RAISE EXCEPTION 'image_path is not in the author''s folder for this thread' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_image_path_guard ON public.messages;
CREATE TRIGGER messages_image_path_guard
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.check_message_image_path();

-- Private bucket. No storage.objects policies on purpose: only the service role (mobile-api)
-- signs uploads and downloads, after checking the caller can read/post in the thread.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-photos', 'chat-photos', false, 10485760, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- ============ Calendar feeds ============
-- One secret feed URL per user; calendar apps fetch it without signing in.
CREATE TABLE IF NOT EXISTS public.calendar_feeds (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_fetched_at timestamptz
);
ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_feeds FROM anon, authenticated;
GRANT ALL ON public.calendar_feeds TO service_role;

-- ============ Season-long team codes ============
-- Team codes (not co-parent invites) already shared in group chats keep working all season.
UPDATE public.team_invites
SET expires_at = greatest(expires_at, now() + interval '365 days')
WHERE player_id IS NULL AND revoked_at IS NULL AND expires_at > now();
