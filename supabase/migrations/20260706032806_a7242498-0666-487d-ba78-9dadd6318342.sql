
CREATE UNIQUE INDEX IF NOT EXISTS message_threads_one_team_chat_per_team
  ON public.message_threads (team_id)
  WHERE kind = 'team'
    AND event_id IS NULL
    AND audience = 'both'
    AND title = 'Team chat'
    AND deleted_at IS NULL;
