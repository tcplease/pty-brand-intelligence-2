-- intel_future_shows — one row per Monday item in the "Future Shows" group
-- of board 5517797966 ("Future Shows - Count, Close & Data Automations").
-- READ-ONLY mirror of Monday; never written back. Populated by
-- /api/sync/future-shows. Apply this DDL directly in the Supabase SQL editor
-- (repo has no migration system). Then keep docs/data-dictionary.md +
-- src/types/index.ts in sync by hand.

create table if not exists public.intel_future_shows (
  monday_item_id        bigint primary key,            -- Monday item id (board 5517797966)
  artist_name           text not null,                 -- Monday item name (verbatim)
  chartmetric_id        integer references public.intel_artists(chartmetric_id) on delete set null,
  match_status          text not null default 'unmatched', -- 'exact' | 'normalized' | 'unmatched'
  show_date             date,                           -- date4 column
  venue_name            text,                           -- parsed: first segment of the Venue blob
  city                  text,
  state                 text,                           -- US 2-letter only (NULL for non-US)
  country               text,                           -- 'US' for USA, else as written ('Germany','UK'…)
  geo_status            text not null default 'unknown',-- 'ok' (parsed) | 'unknown' (bare/empty venue)
  full_address          text,                           -- original Venue blob, unchanged (map link)
  monday_last_synced_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Drill-down filter indexes (date range + geo facets, all gated on geo_status='ok')
create index if not exists idx_future_shows_show_date  on public.intel_future_shows (show_date);
create index if not exists idx_future_shows_country     on public.intel_future_shows (country);
create index if not exists idx_future_shows_state       on public.intel_future_shows (state);
create index if not exists idx_future_shows_city        on public.intel_future_shows (city);
create index if not exists idx_future_shows_geo_status  on public.intel_future_shows (geo_status);
create index if not exists idx_future_shows_cm_id       on public.intel_future_shows (chartmetric_id);
