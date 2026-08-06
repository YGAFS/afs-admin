-- ============================================================
-- Add display order to utility_locations (contract signing order)
-- Safe to run multiple times
-- ============================================================

alter table utility_locations
  add column if not exists sort_order integer not null default 0;

-- TNT locations, in contract order
update utility_locations set sort_order = 1 where company_id = 'tnt' and name = 'Cambridge';
update utility_locations set sort_order = 2 where company_id = 'tnt' and name = 'Biscayne';
update utility_locations set sort_order = 3 where company_id = 'tnt' and name = 'Pickering';
