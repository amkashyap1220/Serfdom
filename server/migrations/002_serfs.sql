-- Phase 7b: serfs (characters), with lifetime stats and permadeath
-- (D-061 two living per account, D-062 death is permanent, D-064 names
-- unique among the living).

create table serfs (
  id bigint generated always as identity primary key,
  account_id bigint not null references accounts (id) on delete cascade,
  name text not null,
  level integer not null default 1 check (level between 1 and 20),
  created_at timestamptz not null default now(),
  -- Set once, never cleared: a dead serf stays dead.
  died_at timestamptz,
  death_dungeon text,
  killed_by text,
  -- Lifetime stats, added up from every finished run.
  runs integer not null default 0 check (runs >= 0),
  clears integer not null default 0 check (clears >= 0),
  seconds double precision not null default 0 check (seconds >= 0),
  shots_fired bigint not null default 0 check (shots_fired >= 0),
  shots_hit bigint not null default 0 check (shots_hit >= 0),
  damage_dealt bigint not null default 0 check (damage_dealt >= 0),
  enemies_defeated bigint not null default 0 check (enemies_defeated >= 0),
  damage_taken bigint not null default 0 check (damage_taken >= 0)
);

-- Two living serfs may not share a name, whatever the capitalization; the
-- dead do not count, so a fallen serf's name can be used again.
create unique index serfs_living_name_key on serfs (lower(name))
  where died_at is null;

create index serfs_account_id_idx on serfs (account_id);
