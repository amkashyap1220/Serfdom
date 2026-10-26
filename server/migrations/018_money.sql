-- D-157: money is counted in Bronze (1,000 Bronze = 1 Silver, 1,000 Silver
-- = 1 Gold, 1,000 Gold = 1 Platinum). Amounts from before were gold: one
-- old gold becomes 1 Silver. The column keeps its name.
update accounts set gold = gold * 1000;
comment on column accounts.gold is 'The account''s money, in Bronze (D-157).';

alter table listings drop constraint listings_price_check;
update listings set price = price * 1000;
alter table listings add constraint listings_price_check
  check (price between 1 and 1000000000);

alter table orders drop constraint orders_price_check;
update orders set price = price * 1000;
alter table orders add constraint orders_price_check
  check (price between 1 and 1000000000);

update sales set price = price * 1000, fee = fee * 1000;
