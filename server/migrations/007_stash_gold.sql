-- Phase 9a: no serf bag (D-085). Items belong to the account and are in
-- one of three places: the shared stash, equipped on one of its serfs, or
-- pending (a reward that did not fit, held for the serf that won it,
-- D-088). Accounts get gold from selling (D-087). Bag items from the
-- 9a-1 test build become stash items; items of dead serfs are dropped.

alter table accounts
  add column gold bigint not null default 0 check (gold >= 0);

delete from items
  where serf_id in (select id from serfs where died_at is not null);

alter table items
  add column account_id bigint references accounts (id) on delete cascade,
  add column location text not null default 'stash'
    check (location in ('stash', 'equipped', 'pending'));

update items set account_id = serfs.account_id
  from serfs where serfs.id = items.serf_id;

update items set location = 'equipped' where equipped is not null;
update items set serf_id = null where location = 'stash';

alter table items
  alter column account_id set not null,
  alter column serf_id drop not null,
  -- A stash item has no serf; equipped and pending items name theirs.
  add constraint items_serf_by_location
    check ((location = 'stash') = (serf_id is null)),
  -- Only equipped items have a worn slot.
  add constraint items_slot_by_location
    check ((location = 'equipped') = (equipped is not null));

create index items_account_idx on items (account_id, location, id);
