# PTY Intelligence Platform — Database Data Dictionary

> Complete listing of every table and column (header) in the Supabase (PostgreSQL) database.
> Generated from a live introspection of the database. Row counts as of June 2026.
> **`chartmetric_id`** is the universal key linking an artist across all tables.

Database: **Supabase (PostgreSQL)** · Tables: 10 active (+ 3 empty/legacy listed at the end)

---

## intel_artists — master artist record (1,782 rows)
One row per artist. The hub all other tables link to.

| Column | Type | Description |
|---|---|---|
| chartmetric_id | integer | **Primary key.** Chartmetric's universal artist ID |
| name | text | Artist name |
| image_url | text | Artist photo URL |
| career_stage | text | legendary / superstar / mainstream / mid-level / developing / undiscovered |
| cm_score | numeric | Chartmetric artist score |
| general_manager | text | Manager name (from Chartmetric) |
| spotify_followers | integer | Spotify follower count |
| spotify_monthly_listeners | integer | Spotify monthly listeners |
| instagram_followers | integer | Instagram follower count |
| youtube_subscribers | integer | YouTube subscriber count |
| tiktok_followers | integer | TikTok follower count |
| primary_genre | text | Primary genre |
| primary_market | text | Primary geographic market |
| secondary_market | text | Secondary geographic market |
| audience_male_pct | numeric | Audience % male |
| audience_female_pct | numeric | Audience % female |
| age_13_17_pct | numeric | Audience age 13–17 % |
| age_18_24_pct | numeric | Audience age 18–24 % |
| age_25_34_pct | numeric | Audience age 25–34 % |
| age_35_44_pct | numeric | Audience age 35–44 % |
| age_45_64_pct | numeric | Audience age 45–64 % |
| age_65_plus_pct | numeric | Audience age 65+ % |
| audience_ethnicity | jsonb | Audience ethnicity breakdown (key → %) |
| top_countries | jsonb (array) | Top audience countries `[{country, code, pct}]` |
| **spotify_artist_id** | text | **Social handle** — Spotify ID; link = `open.spotify.com/artist/{id}` |
| **instagram_url** | text | **Social handle** — full Instagram profile URL |
| **youtube_url** | text | **Social handle** — full YouTube channel URL |
| **tiktok_url** | text | **Social handle** — full TikTok profile URL |
| last_album_release_date | date | Most recent album release date |
| last_album_name | text | Most recent album name |
| source | text | How the artist entered the system: monday / festival_signal / manual / both |
| discovery_status | text | pipeline / new / resurfaced / dismissed / unlisted |
| dismissed_at | timestamptz | When dismissed from the discovery feed |
| is_active | boolean | Active flag |
| cm_last_refreshed_at | timestamptz | Last full Chartmetric enrichment |
| created_at | timestamptz | Row created |
| updated_at | timestamptz | Row last updated |

> **Social handles live here:** `spotify_artist_id`, `instagram_url`, `youtube_url`, `tiktok_url` (full openable URLs), plus the four follower-count columns. There is no separate handles table.

---

## intel_monday_items — deals from Monday.com (2,156 rows)
One row per deal (an artist can have several deals across tours).

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| monday_item_id | bigint | Monday.com board item ID |
| artist_name | text | Artist name as it appears on the Monday board |
| chartmetric_id | integer | Link to `intel_artists` (nullable until matched) |
| tour | text | Tour / project name |
| sales_lead | text | Assigned sales lead |
| stage | text | Deal stage (Outbound → Won / Lost / Fell Off, etc.) |
| close_probability | integer | Close probability % |
| project_type | text | e.g. TourVIP, BrandPartnerships |
| priority | text | High / Medium / Low |
| total_events | integer | Number of events |
| first_show | date | First show date |
| last_show | date | Last show date |
| proj_gross | numeric | Projected gross |
| proj_pty_net | numeric | Projected P&TY net |
| announce_date | date | Announce date |
| pre_sale_date | date | Pre-sale date |
| on_sale_date | date | On-sale date |
| deal_creation_date | date | When the deal was created on Monday |
| monday_last_synced_at | timestamptz | Last sync from Monday |
| created_at | timestamptz | Row created |
| cm_search_attempted_at | timestamptz | Last Chartmetric name-search attempt (for linking) |
| cm_search_result | text | Outcome of name search: no_match / ambiguous (null once linked) |

---

## intel_artist_contacts — management / agency contacts (1,584 rows)

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| chartmetric_id | integer | Link to `intel_artists` |
| role | text | manager / agent / business_manager |
| contact_name | text | Contact person name |
| company_name | text | Company name |
| email | text | Email |
| phone | text | Phone |
| street | text | Street address |
| city | text | City |
| state | text | State |
| zip | text | Postal code |
| country | text | Country |
| linkedin_url | text | LinkedIn profile URL |
| region | text | NA / EU / ASIA / global |
| source | text | rostr / monday / manual |
| last_verified_at | timestamptz | Last verified |
| created_at | timestamptz | Row created |
| updated_at | timestamptz | Row last updated |

---

## intel_brand_affinities — audience brand affinities (70,598 rows)
Brands the artist's audience over-indexes on (Chartmetric, affinity ≥ 1.0).

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| chartmetric_id | integer | Link to `intel_artists` |
| brand_id | integer | Chartmetric brand ID |
| brand_name | text | Brand name |
| affinity_scale | numeric | Affinity multiplier (≥ 1.0 = over-index) |
| follower_count | integer | Audience following this brand |
| interest_category | text | Brand category |
| created_at | timestamptz | Row created |

---

## intel_sector_affinities — audience sector/interest affinities (24,711 rows)

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| chartmetric_id | integer | Link to `intel_artists` |
| sector_id | integer | Chartmetric sector ID |
| sector_name | text | Sector / interest name |
| affinity_scale | numeric | Affinity multiplier (≥ 1.0 = over-index) |
| created_at | timestamptz | Row created |

---

## activity_log — signal & event timeline (2,916 rows)
Discovery signals and status changes per artist.

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| chartmetric_id | integer | Link to `intel_artists` |
| event_type | text | album_presave / album_cycle_signal / festival_added / metric_spike / stage_change / added_to_pipeline |
| event_title | text | Human-readable event title |
| event_detail | jsonb | Structured event payload |
| event_date | date | When the event occurs/occurred |
| created_at | timestamptz | When detected |

---

## festival_appearances — festival bookings (922 rows)

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| chartmetric_id | integer | Link to `intel_artists` |
| festival_cm_id | integer | Chartmetric festival ID |
| festival_name | text | Festival name |
| festival_date | date | Festival date |
| festival_location | text | City, country |
| festival_size | text | small / medium / large / mega |
| bill_position | text | Headliner / support / etc. |
| detected_at | timestamptz | When detected |

---

## release_calendar — scraped upcoming releases (1,304 rows)
Raw + matched album releases from the web-calendar scrapers.

| Column | Type | Description |
|---|---|---|
| id | bigint | Primary key |
| source | text | billboard / genius_album / pitchfork / consequence |
| source_url | text | Source page URL |
| artist_name_raw | text | Artist name as scraped |
| album_name | text | Album/release title |
| release_date | date | Release date |
| release_type | text | album / ep / single / unknown |
| chartmetric_id | integer | Link to `intel_artists` (null if unmatched) |
| matched_via | text | exact / alias (how it matched the roster) |
| matched_at | timestamptz | When matched |
| detected_at | timestamptz | When scraped |
| raw_payload | jsonb | Original scraped record |

---

## app_users — application access list (22 rows)

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| email | text | User email (must be @please.co) |
| name | text | User name |
| role | text | Application role |
| monday_person_id | text | Linked Monday.com person ID |
| monday_person_name | text | Linked Monday.com person name |
| is_active | boolean | Active flag |
| created_at | timestamptz | Row created |
| updated_at | timestamptz | Row last updated |

---

## saved_pitches — saved AI-generated pitches (1 row)

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| chartmetric_id | integer | Link to `intel_artists` |
| created_by_email | text | Author email |
| created_by_name | text | Author name |
| pitch_text | text | Generated pitch content |
| pitch_prompt | text | Prompt/brief used to generate it |
| created_at | timestamptz | Row created |

---

## artist_aliases — alternate artist names for matching (0 rows, currently empty)
Used by the release-calendar matcher to map alternate spellings to an artist.

| Column | Type | Description |
|---|---|---|
| chartmetric_id | integer | Link to `intel_artists` |
| alias | text | Alternate name/spelling |

---

## intel_future_shows — future show dates from Monday (read-only mirror)
Mirror of the **"Future Shows"** group on Monday board **5517797966** (a different
board than the deals board). One row per Monday item. Populated by
`/api/sync/future-shows` (nightly cron + manual Refresh on `/live`). Never written
back to Monday. DDL: `docs/future-shows-ddl.sql`.

| Column | Type | Description |
|---|---|---|
| monday_item_id | bigint | **Primary key.** Monday item id (board 5517797966) |
| artist_name | text | Monday item name, verbatim |
| chartmetric_id | integer | FK → `intel_artists`; NULL when unmatched |
| match_status | text | `exact` / `normalized` / `unmatched` (see B3 matcher) |
| show_date | date | From the `date4` column |
| venue_name | text | Parsed first segment of the Venue blob |
| city | text | Parsed city |
| state | text | US 2-letter code only; NULL for non-US |
| country | text | `US` for USA, else as written (`Germany`, `UK`…) |
| geo_status | text | `ok` (parsed) / `unknown` (bare or empty venue — excluded from filters) |
| full_address | text | Original Venue blob, unchanged (Google Maps link) |
| monday_last_synced_at | timestamptz | Last sync touch |
| created_at | timestamptz | Row insert time |
| updated_at | timestamptz | Last write time |

---

## Empty / legacy tables (not in use)
These exist but hold no data — the live signal subsystem uses the unprefixed tables above by design.

| Table | Status |
|---|---|
| intel_activity_log | Empty — superseded by `activity_log` |
| intel_festival_appearances | Empty — superseded by `festival_appearances` |
| artist_aliases | Empty — available for the matcher when populated |

---

*Notes:* `id` columns are UUIDs except `release_calendar.id` and `artist_aliases` (bigint/serial). A "fill-don't-clobber" trigger on `intel_artists` prevents populated Chartmetric/social fields from being overwritten with nulls by a later sync.
