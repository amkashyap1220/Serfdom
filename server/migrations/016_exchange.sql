-- Phase 17: the Grand Serf Exchange (D-155). A listed item or potion keeps
-- its row (and its owner until it sells) at location 'listed'; a listing
-- names it and its price; a sale is kept for "My listings".

alter table items drop constraint items_location_check;
alter table items add constraint items_location_check
  check (location in ('stash', 'equipped', 'pending', 'listed'));
alter table items drop constraint items_serf_by_location;
alter table items add constraint items_serf_by_location
  check ((location in ('stash', 'listed')) = (serf_id is null));

alter table potions drop constraint potions_location_check;
alter table potions add constraint potions_location_check
  check (location in ('rack', 'pending', 'listed'));
alter table potions drop constraint potions_serf_by_location;
alter table potions add constraint potions_serf_by_location
  check ((location in ('rack', 'listed')) = (serf_id is null));

create table listings (
  id bigint generated always as identity primary key,
  seller_id bigint not null references accounts (id) on delete cascade,
  item_id bigint unique references items (id) on delete cascade,
  potion_id bigint unique references potions (id) on delete cascade,
  price integer not null check (price between 1 and 1000000),
  listed_at timestamptz not null default now(),
  -- One thing per listing: an item or a potion.
  check ((item_id is null) <> (potion_id is null))
);

create index listings_seller_idx on listings (seller_id);

create table sales (
  id bigint generated always as identity primary key,
  seller_id bigint not null references accounts (id) on delete cascade,
  buyer_id bigint not null references accounts (id) on delete cascade,
  what text not null,
  price integer not null check (price >= 1),
  fee integer not null check (fee >= 0),
  sold_at timestamptz not null default now()
);

create index sales_seller_idx on sales (seller_id, sold_at desc);
create index sales_buyer_idx on sales (buyer_id, sold_at desc);
