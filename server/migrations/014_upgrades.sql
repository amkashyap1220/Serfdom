-- D-154: account upgrades bought with gold. Each counts the purchases
-- made; capacity is the free amount plus a step per purchase (shared
-- upgrades.ts). They belong to the account, so a serf's death never
-- loses them.

alter table accounts
  add column serf_slots_bought integer not null default 0
    check (serf_slots_bought between 0 and 8),
  add column stash_bought integer not null default 0
    check (stash_bought between 0 and 8),
  add column rack_bought integer not null default 0
    check (rack_bought between 0 and 4);
