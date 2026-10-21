
ALTER TABLE public.notification_sends
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_path text;

GRANT UPDATE (read_at) ON public.notification_sends TO authenticated;

DROP POLICY IF EXISTS "Recipient marks own send read" ON public.notification_sends;
CREATE POLICY "Recipient marks own send read"
  ON public.notification_sends
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS notification_sends_recipient_unread_idx
  ON public.notification_sends (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notification_sends_recipient_created_idx
  ON public.notification_sends (recipient_user_id, created_at DESC);
