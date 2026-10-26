-- D-153: lets an Artifact be tier 12. Migration 013 does this too, but a
-- database that ran 013's first draft (before the tier check was added to
-- it) still refuses every Artifact; this replaces the check either way.

alter table items drop constraint items_tier_check;
alter table items add constraint items_tier_check check (
  (artifact is null and tier between 0 and 10)
  or (artifact is not null and tier = 12)
);
