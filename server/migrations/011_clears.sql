-- Phase 15d: every completed run, for the fastest-clear leaderboards
-- (D-148). The time is the server's own count of the run; the party size
-- is the most players the run held. Records start with this migration.

create table clears (
  id bigint generated always as identity primary key,
  serf_id bigint not null references serfs (id) on delete cascade,
  dungeon text not null,
  seconds double precision not null check (seconds >= 0),
  party_size integer not null check (party_size between 1 and 10),
  cleared_at timestamptz not null default now()
);

create index clears_dungeon_seconds_idx on clears (dungeon, seconds);
