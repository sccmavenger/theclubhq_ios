-- Clubs Phase 1 (D-044): directors post in team chats; the server finds accounts by email.

DO $$ BEGIN
  CREATE POLICY "club directors post in team chats" ON public.messages FOR INSERT TO authenticated
    WITH CHECK (author_id = auth.uid() AND private.director_can_read_thread(auth.uid(), thread_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service role only (mobile-api assigning a coach by email). Never callable by app users.
CREATE OR REPLACE FUNCTION public.club_user_id_by_email(_email text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.club_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_user_id_by_email(text) TO service_role;
