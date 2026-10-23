-- Phase 8c: rolled stats (D-074, T-048). `stats` holds the eight growing
-- stats as JSON (null = a fresh Serf's base stats); `stats_level` is the
-- level they have been rolled up to. The server rolls any missing levels
-- and saves them with a guard on stats_level, so a level is never rolled
-- twice. Existing serfs start at level 1 and catch up when next played.

alter table serfs
  add column stats jsonb,
  add column stats_level smallint not null default 1
    check (stats_level between 1 and 20);
