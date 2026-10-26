-- D-156: buy orders, the collection box, and price history. Bought things
-- wait at location 'collect' until collected; listings, orders, and sales
-- name "the same item" (a market key, shared market.ts).

alter table items drop constraint items_location_check;
alter table items add constraint items_location_check
  check (location in ('stash', 'equipped', 'pending', 'listed', 'collect'));
alter table items drop constraint items_serf_by_location;
alter table items add constraint items_serf_by_location
  check ((location in ('stash', 'listed', 'collect')) = (serf_id is null));

alter table potions drop constraint potions_location_check;
alter table potions add constraint potions_location_check
  check (location in ('rack', 'pending', 'listed', 'collect'));
alter table potions drop constraint potions_serf_by_location;
alter table potions add constraint potions_serf_by_location
  check ((location in ('rack', 'listed', 'collect')) = (serf_id is null));

alter table listings add column market_key text not null default '';
-- Listings from before this migration get their key here.
update listings l set market_key = case
    when i.artifact is not null then 'a:' || i.artifact || case when i.shiny then ':shiny' else '' end
    else 't:' || i.tier || ':' || i.slot || ':' || coalesce(i.type, '') || case when i.shiny then ':shiny' else '' end
  end
  from items i where i.id = l.item_id;
update listings l set market_key = 'p:' || p.stat from potions p where p.id = l.potion_id;
create index listings_key_idx on listings (market_key, price);

alter table sales add column market_key text;
create index sales_key_idx on sales (market_key, sold_at);

create table orders (
  id bigint generated always as identity primary key,
  buyer_id bigint not null references accounts (id) on delete cascade,
  market_key text not null,
  -- Rolls the item must have (stats or 'luck'); empty: any.
  rolls text[] not null default '{}',
  -- The most the buyer pays; this much gold is set aside while it waits.
  price integer not null check (price between 1 and 1000000),
  placed_at timestamptz not null default now()
);

create index orders_key_idx on orders (market_key, price desc);
create index orders_buyer_idx on orders (buyer_id);
