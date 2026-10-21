-- Remove E2E test rows created during the coach-role automated pass
DELETE FROM public.events WHERE team_id='2976f667-1647-40b8-9b70-f3feeb5f15b6' AND title LIKE 'E2E %';
DELETE FROM public.announcements WHERE team_id='2976f667-1647-40b8-9b70-f3feeb5f15b6' AND title LIKE 'E2E %';
DELETE FROM public.players WHERE team_id='2976f667-1647-40b8-9b70-f3feeb5f15b6' AND (first_name LIKE 'TestE2E%' OR first_name LIKE 'EditE2E%');