-- D-106: rings, necklaces, and capes have a base stat (stored in `type`);
-- no item has extra stat rolls before T4; an extra roll is at most +3
-- (+9 for HP and MP); an accessory never rolls its own base stat; Luck
-- (0 or +1) only on items with at least one roll. Existing items are
-- brought in line so every stored item stays valid (the server refuses to
-- load an item its rules could not have made). Development data only.

-- Below T4: no extra rolls, so no Luck either.
update items set rolls = '[]'::jsonb, luck = 0 where tier < 4;

-- T4 and up: the roll count per tier is unchanged; sizes shrink to the cap.
update items set rolls = (
  select coalesce(jsonb_agg(jsonb_build_object(
    'stat', r ->> 'stat',
    'amount', sign((r ->> 'amount')::int)
      * least(abs((r ->> 'amount')::int),
              case when r ->> 'stat' in ('hp', 'mp') then 9 else 3 end)
  ) order by ord), '[]'::jsonb)
  from jsonb_array_elements(items.rolls) with ordinality as e(r, ord)
) where tier >= 4;

-- Accessories get a random base stat that none of their rolls use.
update items set type = (
  select stat from unnest(array[
    'hp', 'mp', 'attack', 'dexterity', 'speed', 'defense', 'vitality', 'wisdom'
  ]) as stat
  where stat not in (
    select r ->> 'stat' from jsonb_array_elements(items.rolls) as r
  )
  order by random()
  limit 1
) where slot in ('ring', 'necklace', 'cape');
