-- ===========================================================================
-- PRODUCTION PHASE 5 �?" TERRITORY GEO + MAP-BASED ROUTE PLANNING
--
-- Adds a geographic center + radius to territories so each territory maps to a
-- Google Maps area (search a place, pick a radius, territory = covered circle).
-- Routes are then built on top of a selected territory's area with map-picked
-- stops. Idempotent: safe to run repeatedly in the Supabase SQL editor.
--
-- Run AFTER production_phase5_fsm.sql.
-- ===========================================================================

alter table public.territories
  add column if not exists center_lat double precision,
  add column if not exists center_lng double precision,
  add column if not exists radius_km numeric(6, 2);

-- Optional: partial unique index on territory geo is unnecessary; each
-- organization manages its own places. Just index for lookups.
create index if not exists territories_org_geo_idx
  on public.territories (organization_id, center_lat, center_lng);

-- Verify columns exist (PASS expected).
select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'territories'
  and column_name in ('center_lat', 'center_lng', 'radius_km')
order by column_name;