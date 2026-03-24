# PTY Intel — Rising Index Pipeline & Schema Updates
**Created:** March 24, 2026
**Status:** Ready for Claude Code
**Phase:** Phase 2 — Discovery Engine
**Context:** Chartmetric's Rising Index (Talent Search) tool scores artists across seven signals on a 1-10 scale. P&TY will use it as a supplemental discovery pipeline alongside festival monitoring. Initially manual CSV import, with a path toward automation.

---

## How to Use This Document

Tasks are ordered sequentially. TASK 01 (schema) must be completed before TASK 02 (import pipeline). TASK 03 (UI) depends on both. Do not skip ahead.

---

## Task List

---

### TASK 01 — Schema Updates: Add `top_genres` and Rising Index Fields to `artists` Table
**Priority:** P1 | **Complexity:** S | **Files:** Supabase migration, `types/index.ts`

**Problem:** The `artists` table currently stores `primary_genre` as a single TEXT field. Chartmetric's API returns a `top_genres` array (from `tags.top_genres` on the artist response) with 3-5 genre tags per artist. We need this for genre filtering in Discovery. We also need fields to store Rising Index signal scores for artists imported via CSV.

**Schema changes — add these columns to the `artists` table:**

```sql
-- Genre data from Chartmetric API
-- Source: artist response -> tags.top_genres array
-- Example: ["hip hop", "rap", "pop rap", "southern hip hop", "trap music"]
ALTER TABLE artists ADD COLUMN IF NOT EXISTS top_genres JSONB DEFAULT '[]'::jsonb;

-- Rising Index signal scores (1-10 scale, nullable)
-- Source: Chartmetric Rising Index CSV export or future API
ALTER TABLE artists ADD COLUMN IF NOT EXISTS ri_consistent_growth SMALLINT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS ri_synchronous_growth SMALLINT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS ri_user_engagement SMALLINT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS ri_user_curation SMALLINT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS ri_editorial_curation SMALLINT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS ri_trigger_cities SMALLINT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS ri_international_development SMALLINT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS ri_audience_concentration SMALLINT;

-- Track when Rising Index data was last updated
ALTER TABLE artists ADD COLUMN IF NOT EXISTS ri_last_updated_at TIMESTAMPTZ;

-- Recent momentum label from Chartmetric
-- Values: "Growth", "Explosive Growth", or null
ALTER TABLE artists ADD COLUMN IF NOT EXISTS recent_momentum TEXT;
```

**Keep `primary_genre`** — it stays as a quick-display field (the first item from `top_genres`, or the existing value for legacy records). Do not remove it.

**Index for genre filtering:**
```sql
-- GIN index enables fast @> and ?| queries on the JSONB genre array
CREATE INDEX IF NOT EXISTS idx_artists_top_genres ON artists USING GIN (top_genres);
```

**TypeScript type updates** — add to the `Artist` interface in `types/index.ts`:
```typescript
top_genres: string[]
ri_consistent_growth: number | null
ri_synchronous_growth: number | null
ri_user_engagement: number | null
ri_user_curation: number | null
ri_editorial_curation: number | null
ri_trigger_cities: number | null
ri_international_development: number | null
ri_audience_concentration: number | null
ri_last_updated_at: string | null
recent_momentum: string | null
```

**Populate `top_genres` for existing artists:** When pulling Chartmetric data for any artist (new or existing), read `tags.top_genres` from the API response and store it. The array comes with values wrapped in single quotes (e.g., `"'hip hop'"`). Strip the quotes before storing:
```typescript
// Chartmetric returns: ["'hip hop'", "'rap'", "'pop rap'"]
// We store: ["hip hop", "rap", "pop rap"]
const topGenres = (cmResponse.tags?.top_genres || [])
  .map((g: string) => g.replace(/^'+|'+$/g, '').trim())
  .filter(Boolean);
```

**Also update `primary_genre`** — set it to `top_genres[0]` whenever `top_genres` is populated, so existing UI that reads `primary_genre` stays consistent.

---

### TASK 02 — Rising Index CSV Import Pipeline (Admin Tool)
**Priority:** P1 | **Complexity:** L | **Files:** New API route `/api/admin/import-rising-index`, new admin page `/app/admin/rising-index/page.tsx`

**Problem:** Chartmetric's Rising Index tool is dashboard-only (no API endpoint). The team exports a CSV weekly and needs to import those leads into the platform.

**CSV format** (from Chartmetric Rising Index export):
```
Artist,Country,Region,Pronouns,Genres,Career Stage,Recent Momentum,First Release Date,Latest Release Date,Consistent Growth,Synchronous Growth,User Engagement,User Curation,Editorial Curation,Trigger Cities,International Development,Audience Concentration
Jessica Vosk,United States,North America,She/Her,"Pop,Holiday,US Holiday,US Pop",Mainstream,Growth,"Aug 10, 2018","Jan 14, 2026",10,,,5,7,2,7,
```

**Key fields in CSV:**
- `Artist` — artist name (string)
- `Country` — e.g., "United States"
- `Genres` — comma-separated, may be quoted if contains commas
- `Career Stage` — "Mid-Level" or "Mainstream"
- `Recent Momentum` — "Growth" or "Explosive Growth"
- `Consistent Growth` through `Audience Concentration` — integer 1-10 or empty

**Import flow:**

1. **Parse CSV.** Use a proper CSV parser (papaparse or similar) that handles quoted fields with internal commas. The Genres field will break naive comma-splitting.

2. **For each artist row:**
   a. Search Chartmetric API by artist name to get `chartmetric_id`. Use the existing Chartmetric search pattern in the codebase.
   b. If artist already exists in `artists` table (by `chartmetric_id`): update Rising Index scores and `recent_momentum`. Do NOT overwrite existing Chartmetric data (demographics, followers, etc.) — that comes from the full CM data pull.
   c. If artist is new (not in `artists` table): create a new record. Pull full Chartmetric data (demographics, brand affinities, sector interests, `top_genres`) the same way Pipeline 1 and Pipeline 2 do for new artists. Then also store the Rising Index scores.
   d. Store Rising Index scores:
      - `ri_consistent_growth` = CSV `Consistent Growth` (integer or null if empty)
      - `ri_synchronous_growth` = CSV `Synchronous Growth`
      - `ri_user_engagement` = CSV `User Engagement`
      - `ri_user_curation` = CSV `User Curation`
      - `ri_editorial_curation` = CSV `Editorial Curation`
      - `ri_trigger_cities` = CSV `Trigger Cities`
      - `ri_international_development` = CSV `International Development`
      - `ri_audience_concentration` = CSV `Audience Concentration`
      - `ri_last_updated_at` = current timestamp
      - `recent_momentum` = CSV `Recent Momentum`
   e. Set `source` to `"rising_index"` for new artists, or append to existing source if artist already has one (e.g., if source was `"monday"`, update to `"both"` or keep existing — do not overwrite `"monday"` with `"rising_index"`).
   f. Log to `activity_log`:
      - `event_type`: `"rising_index_signal"`
      - `event_title`: "Flagged by Rising Index — [Recent Momentum]"
      - `event_detail`: JSON with all seven signal scores
      - `event_date`: today
      - `created_at`: now

3. **Return a summary** to the UI: number of artists processed, number new, number updated, number failed (with reasons — e.g., "could not find on Chartmetric").

**API cost consideration:** Each new artist requires a Chartmetric name search + full data pull. A typical CSV has ~50-100 artists. Most will already be in the system after the first import. Budget ~50-100 Chartmetric API calls for the first import, then ~5-20 per week for subsequent imports (only new artists).

**Error handling:**
- If Chartmetric name search returns multiple results, pick the best match by: exact name match first, then highest `cm_score` among matches. Log ambiguous matches in the response so the rep can review.
- If Chartmetric name search returns zero results, skip the artist and include in the "failed" list.
- If CSV parsing fails (bad format, missing headers), reject the entire upload with a clear error message.

---

### TASK 03 — Admin UI: Rising Index Import Page
**Priority:** P1 | **Complexity:** M | **Files:** `/app/admin/rising-index/page.tsx`

**Problem:** Need a simple admin interface for uploading the weekly CSV export.

**Page location:** `/admin/rising-index` — add a link to this from the existing admin/tools section (same area as the contact export tool).

**UI spec:**

**Upload section:**
- Drag-and-drop zone + file picker button for CSV upload
- Accepted file types: `.csv` only
- Max file size: 5MB (more than enough for ~500 rows)
- On file selection, show filename and row count preview (parse client-side with papaparse)

**Pre-import preview:**
- Show a table of the first 10 rows: Artist, Career Stage, Momentum, Consistent Growth, User Curation (just the key fields, not all columns)
- Show total row count: "95 artists ready to import"
- "Import" button (primary, Electric Yellow) and "Cancel" button

**During import:**
- Progress indicator showing "Processing artist X of Y..."
- Don't block the UI — use a streaming or polling approach so the rep sees progress

**Post-import summary:**
- Green section: "X artists imported successfully (Y new, Z updated)"
- Yellow section (if any): "X artists had ambiguous matches — review recommended" with a list of artist names and the matches found
- Red section (if any): "X artists could not be found on Chartmetric" with a list of names

**Styling:** Match existing admin page patterns. Dark mode, Stage Black background, Electric Yellow accents on primary actions.

---

### TASK 04 — Discovery View: Add Rising Index Signal Type + Genre Filter
**Priority:** P2 | **Complexity:** M | **Files:** Discovery page, discovery API route

**Problem:** The Discovery view currently shows artists from festival signals only. Rising Index imports need to appear here too, and genre filtering needs to use the new `top_genres` array.

**Signal type filter update:**
- Add `"rising_index"` to the signal type filter options
- Current options: `festival` / `pre_save` / `metric_spike`
- New options: `festival` / `pre_save` / `metric_spike` / `rising_index`
- Rising Index artists show a distinct badge/chip on their Discovery card (e.g., "Rising" with an upward arrow icon)

**Genre filter update:**
- Replace the current genre filter (which reads from `primary_genre`) with a multi-select that queries `top_genres`
- Populate the genre dropdown dynamically: `SELECT DISTINCT jsonb_array_elements_text(top_genres) AS genre FROM artists WHERE top_genres != '[]' ORDER BY genre`
- Filter logic: show artists where `top_genres` contains ANY of the selected genres (use Postgres `?|` operator)
- UI: horizontal scrollable chip bar (same pattern as career stage filter chips)

**Discovery card updates for Rising Index artists:**
- Show career stage badge (same as festival-sourced artists)
- Show "Rising" signal badge instead of festival chips
- Show `recent_momentum` value as a subtitle ("Growth" or "Explosive Growth")
- On click, go to artist page as usual

**Sort option:**
- Add "By User Curation" as a sort option (descending, `ri_user_curation`)
- Add "By Consistent Growth" as a sort option (descending, `ri_consistent_growth`)
- These only apply to artists that have Rising Index data — artists without RI scores sort to the bottom when these sorts are active

---

### TASK 05 — Artist Page: Display Rising Index Scores
**Priority:** P2 | **Complexity:** S | **Files:** Artist detail page, Intelligence tab

**Problem:** Rising Index signal scores are stored but not visible on the artist page.

**Where to display:** On the Intelligence tab, add a "Growth Signals" section above or below the existing demographics section. Only show this section if the artist has Rising Index data (`ri_last_updated_at` is not null).

**Layout:** A compact row of score badges, similar to how the Chartmetric dashboard displays them:

```
Growth Signals (via Chartmetric Rising Index)
Updated: Mar 24, 2026

Consistent Growth: 10  |  User Curation: 9  |  User Engagement: N/A  |  Editorial Curation: 4
Trigger Cities: N/A    |  International Dev: 5  |  Audience Concentration: N/A
Momentum: Growth
```

**Visual treatment:**
- Each score as a small pill/badge with the number
- Color coding: 8-10 = Electric Yellow background, 5-7 = muted/neutral, 1-4 = dim/gray
- N/A scores shown as gray "—" dash
- "Momentum" label with the value as a colored badge (Growth = blue, Explosive Growth = Electric Yellow)

**Do not show this section** for artists who came from Monday.com or festival signals only and don't have RI data. The section should only render when `ri_last_updated_at` is not null.

---

### TASK 06 — Update Slack Digest to Include Rising Index Leads
**Priority:** P3 | **Complexity:** S | **Files:** Slack digest cron/function

**Problem:** The Monday morning Slack digest currently covers festival lineup updates and pipeline activity. Rising Index imports should be included.

**What to add to the digest:**
- New section: "Rising Index Leads This Week"
- Query `activity_log` for `event_type = 'rising_index_signal'` in the past 7 days
- Format: artist name, career stage, momentum, top 2 signal scores (highest values)
- Example: "**Jessica Vosk** — Mainstream, Growth — Consistent Growth: 10, User Curation: 5"
- Cap at 10 artists in the digest (if more, add "and X more — check Radar for full list")
- Place this section after festival updates but before pipeline stage changes

---

## CLAUDE.md Updates

When implementing these tasks, also update the CLAUDE.md file with the following additions:

**Add to Data Model Reference, under `artists` key fields:**
```
`top_genres` (JSONB), `ri_consistent_growth` → `ri_audience_concentration` (SMALLINT, nullable), `ri_last_updated_at`, `recent_momentum`
```

**Add to activity_log event_type values:**
```
"rising_index_signal"
```

**Add new section under Data Pipelines / API Integrations:**
```
### Rising Index (manual CSV import, weekly)
- Chartmetric's Rising Index / Talent Search is dashboard-only (no API endpoint)
- Team exports CSV weekly from Chartmetric with filters: Career Stage (Mid-Level, Mainstream), Country (US), Recent Momentum (Growth, Explosive Growth), User Curation (5-10), Consistent Growth (5-10)
- CSV uploaded via /admin/rising-index
- Import pipeline: parse CSV → Chartmetric name lookup → create/update artist record → store RI scores → log to activity_log
- API cost: ~50-100 CM calls for first import, ~5-20/week after (only new artists)
- Rising Index artists appear in Discovery view with "rising_index" signal type
```

**Add to Navigation Structure:**
```
/admin/rising-index  → Rising Index CSV import tool
```

**Update Phasing Reference:**
```
Phase 2 scope now includes: Rising Index CSV import pipeline, top_genres schema addition, genre filter on Discovery
```

---

## Spec Updates (for reference — not for Claude Code to execute)

These are notes for Tim to update the product spec separately:

1. Add `top_genres JSONB` and Rising Index fields to the `artists` table in the Data Model section
2. Add "Pipeline 2B: Rising Index Import" to the Data Pipelines section
3. Add `"rising_index_signal"` to the `activity_log` event_type values
4. Update Discovery View to mention Rising Index as a signal source
5. Note that genre filtering uses `top_genres` array with Postgres JSONB operators, not `primary_genre`
6. Add Rising Index to the Phasing section under Phase 2
