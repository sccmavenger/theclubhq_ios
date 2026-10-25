-- Internal accounts that aren't portal admins (DECISIONS D-041). Additive only (D-003).
--
-- is_internal_user() keeps staff, QA and demo data out of the portal's business metrics. It
-- matched platform admins and @teamclubhq.com / .invalid emails, which missed the owner's
-- personal account (it owns the Mavericks demo team and a test team). This list adds accounts
-- by email without giving them any admin access. Private schema: not exposed to the API.

CREATE TABLE IF NOT EXISTS private.internal_accounts (
  email text PRIMARY KEY CHECK (email = lower(email)),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.internal_accounts FROM PUBLIC, anon, authenticated;

INSERT INTO private.internal_accounts (email, note) VALUES
  ('dguilloryjr@msn.com', 'Owner''s personal account: Mavericks demo team, test teams, TestFlight')
ON CONFLICT (email) DO NOTHING;

CREATE OR REPLACE FUNCTION private.is_internal_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins a WHERE a.user_id = _user_id)
      OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _user_id
                 AND (u.email ILIKE '%@teamclubhq.com' OR u.email ILIKE '%.invalid'
                      OR lower(u.email) IN (SELECT i.email FROM private.internal_accounts i)));
$$;
REVOKE ALL ON FUNCTION private.is_internal_user(uuid) FROM PUBLIC, anon, authenticated;
