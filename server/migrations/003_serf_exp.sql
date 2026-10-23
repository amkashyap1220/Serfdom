-- Phase 8a: lifetime EXP (D-069, T-045). A serf's level is derived from
-- its EXP in code, so the stored level column (always 1 so far) goes away
-- and the two can never disagree.

alter table serfs add column exp bigint not null default 0 check (exp >= 0);
alter table serfs drop column level;

-- The lifetime EXP leaderboard (GDD §12) reads the top of this.
create index serfs_exp_idx on serfs (exp desc, id);
