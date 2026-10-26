-- D-151: what potions have added to each of a serf's stats, so the UI can
-- show it apart from the base (the stats column still holds the total of
-- levels, the class bonus, and potions). Potions drunk before this
-- migration cannot be told apart and count as base.

alter table serfs
  add column potion_stats jsonb not null default
    '{"hp":0,"mp":0,"attack":0,"dexterity":0,"speed":0,"defense":0,"vitality":0,"wisdom":0}';
