-- Phase 12h: stat potions (D-118). A potion belongs to the account and is
-- in the potion rack, or pending (won when the rack was full, held for the
-- serf that won it, like items, D-088). Drinking or pouring one out
-- deletes it. Luck has no potion (D-066).

create table potions (
  id bigserial primary key,
  account_id bigint not null references accounts (id) on delete cascade,
  serf_id bigint references serfs (id) on delete cascade,
  location text not null check (location in ('rack', 'pending')),
  stat text not null check (stat in
    ('hp', 'mp', 'attack', 'dexterity', 'speed', 'defense', 'vitality', 'wisdom')),
  -- A rack potion has no serf; a pending one names the serf it waits for.
  constraint potions_serf_by_location
    check ((location = 'rack') = (serf_id is null))
);

create index potions_account_idx on potions (account_id, location, id);
