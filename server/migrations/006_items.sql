-- Phase 9a: equipment items (D-079–D-083). Every item belongs to one serf
-- (and so to its account). `equipped` is the worn slot, or null in the bag.
-- Items are rolled by the server only; the checks here keep the stored
-- shape sane, the server validates the rest (shared items.ts). A dead
-- serf's items are deleted with its death (D-079).

create table items (
  id bigserial primary key,
  serf_id bigint not null references serfs (id) on delete cascade,
  slot text not null check (slot ~ '^[a-z]{1,16}$'),
  type text check (type ~ '^[a-z]{1,16}$'),
  tier smallint not null check (tier between 0 and 10),
  rolls jsonb not null,
  luck smallint not null check (luck between 0 and 1),
  equipped text check (equipped ~ '^[a-z0-9]{1,16}$'),
  created_at timestamptz not null default now(),
  -- One item per worn slot; bag items (null) are not limited by this.
  unique (serf_id, equipped)
);

create index items_serf_idx on items (serf_id);
