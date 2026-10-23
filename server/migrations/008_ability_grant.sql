-- Phase 10a: each serf gets one free T0 ability item for its class
-- (D-092). The flag makes the grant happen once per serf, also for serfs
-- that chose their class before 10a (they receive it when next played),
-- and stops a sold item from being granted again.

alter table serfs
  add column ability_granted boolean not null default false;
