-- Phase 16a: Artifacts and Shiny items (D-152, D-153). An Artifact names
-- its definition (null on tiered items) and has T12 power; Shiny is looks
-- only.

alter table items
  add column artifact text,
  add column shiny boolean not null default false;

-- Tiered items stay T0-T10; only an Artifact is T12.
alter table items drop constraint items_tier_check;
alter table items add constraint items_tier_check check (
  (artifact is null and tier between 0 and 10)
  or (artifact is not null and tier = 12)
);
