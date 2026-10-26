-- D-159: each account's settings (key binds, fire mode, …) as JSON;
-- null means the defaults. Missing or broken parts read as their defaults.
alter table accounts add column settings jsonb;
