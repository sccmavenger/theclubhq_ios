-- Coaches are told when a family joins their team (DECISIONS D-035).
-- Enum additions live in their own migration (web repo AGENTS.md convention).
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'family_joined';
