-- D-157: Tier 0 gear is free on the Exchange, so it is never listed or
-- ordered. Tier 0 listings from before go back to their sellers'
-- collection boxes; Tier 0 buy orders are refunded.
update items i set location = 'collect'
  from listings l
  where l.item_id = i.id and i.tier = 0 and i.artifact is null;
delete from listings l
  using items i
  where l.item_id = i.id and i.location = 'collect';

update accounts a set gold = a.gold + o.total
  from (select buyer_id, sum(price) total from orders
        where market_key like 't:0:%' group by buyer_id) o
  where a.id = o.buyer_id;
delete from orders where market_key like 't:0:%';
