-- The Exchange is filtered, sorted, and paged in the database (fast at
-- 10,000+ listings): indexes for the two sorts (016 indexes each seller's).
create index listings_price_idx on listings (price, listed_at desc, id desc);
create index listings_newest_idx on listings (listed_at desc, id desc);
