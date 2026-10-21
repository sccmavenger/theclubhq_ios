-- Account deletion must remove the auth user (App Store 5.1.1(v); DECISIONS D-014, D-030).
-- These "who created / who paid" audit columns referenced auth.users with NO ACTION,
-- which blocked deleting any coach or parent who had created data. Keep the records,
-- clear the pointer.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
      AND c.confdeltype IN ('a', 'r')          -- NO ACTION / RESTRICT
      AND c.conrelid::regclass::text IN (
        'organizations', 'teams', 'player_emergency_contacts', 'event_signup_slots',
        'team_payment_accounts', 'dues_requests', 'dues_items')
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', r.tbl, r.col);
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL',
                   r.tbl, r.conname, r.col);
  END LOOP;
END $$;
