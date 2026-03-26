# PTY Intelligence Platform 2.0 — Claude Code Instructions

> Read this file at the start of every session. This is the authoritative source of truth for architecture, design, and coding standards.

---

## Project Identity

**Name:** PTY Intel (working name)  
**Owner:** P&TY  
**Stack:** Next.js / TypeScript / Tailwind CSS → deployed on Vercel  
**Database:** Supabase (PostgreSQL)  
**Auth:** Shared password via Vercel middleware (upgradeable)  
**AI:** Anthropic Claude API (pitch generation, conversational queries)  
**Repo:** Check git remote for current repo location

**Two primary user teams:**
- **Business Development / Sales** — discovery + roster + contacts + intel + pitch builder
- **Brand Partnerships** — intel tab + brand affinity data + pitch builder

---

## Tech Stack & Versions

- **Framework:** Next.js (App Router) with TypeScript — strict mode on
- **Styling:** Tailwind CSS utility classes only — no custom CSS files unless absolutely necessary
- **Database client:** Supabase JS client (`@supabase/supabase-js`)
- **API routes:** Next.js Route Handlers (`/app/api/...`)
- **Deployment:** Vercel
- **Node:** Use whatever version is in `.nvmrc` or `package.json engines`

---

## Absolute Code Quality Standards

These are non-negotiable on every file you touch:

### TypeScript
- Strict TypeScript throughout — no `any` unless explicitly justified with a comment
- Define interfaces for every data shape (see existing interfaces in `page.tsx` as the reference)
- Null safety everywhere — use `?? fallback` patterns, never assume data exists
- Prefer `interface` over `type` for object shapes; use `type` for unions and aliases

### React / Next.js
- Use functional components only — no class components
- `'use client'` only when genuinely needed (interactivity, hooks, browser APIs) — default to server components
- Keep components focused — if a component exceeds ~120 lines, consider splitting it
- Co-locate sub-components in the same file when they're used only once and are small (see existing pattern in `page.tsx`)
- Use `useEffect` cleanup functions whenever subscribing to events or timers
- Avoid prop drilling deeper than 2 levels — lift state or use context

### Performance
- **Never block the main thread** — heavy data processing goes in `useMemo` or server-side
- Lazy load tabs that aren't immediately visible — don't fetch data for a tab until it's first opened
- Images: always use `next/image` with explicit `width` and `height` — no raw `<img>` tags
- API routes: return early and cache aggressively — add `Cache-Control` headers where data is stable
- Supabase queries: always select only the columns you need — no `select('*')` on wide tables
- Keep bundle size lean — check `next build` output; flag if a new dependency adds >50kb

### Error Handling
- Every `fetch` and Supabase call wrapped in try/catch
- API routes return consistent `{ error: string }` on failure with appropriate HTTP status codes
- UI: graceful empty states for every data section — never show a broken/empty component without explanation
- Log errors to console in development; silence in production unless critical

---

## Design System

### Brand Colors — use these constants, never hardcode hex values inline

```typescript
const Y       = '#F9D40A'              // Electric Yellow — primary accent, CTAs, highlights
const BG      = '#0f0f0f'              // Stage Black — page background
const SURFACE  = '#141414'             // Card / panel background
const SURFACE2 = '#1C1C1C'            // Elevated surface (dropdowns, modals)
const SURFACE3 = '#242424'            // Further elevation
const BORDER   = 'rgba(255,255,255,0.08)'  // Subtle borders
const W80      = 'rgba(255,255,255,0.8)'   // Primary text
const W50      = 'rgba(255,255,255,0.5)'   // Secondary text / labels
const W30      = 'rgba(255,255,255,0.3)'   // Tertiary / disabled
const BLUE     = '#60bae1'             // Male indicator, prospect/active stage
const PINK     = '#ec989c'             // Female indicator
const GREEN    = '#00D26A'             // Won / finalizing stage
```

These constants live at the top of each file that uses them. Do not import them from a shared file unless creating a dedicated `constants/colors.ts` — discuss with Tim first.

### Stage Colors

```typescript
const STAGE_COLORS: Record<string, string> = {
  'Outbound - No Contact':                    '#666',
  'Outbound - Automated Contact':             '#666',
  'Prospect - Direct Sales Agent Contact':    BLUE,
  'Active Leads (Contact Has Responded)':     BLUE,
  'Proposal (financials submitted)':          Y,
  'Negotiation (Terms Being Discussed)':      Y,
  'Finalizing On-Sale (Terms Agreed)':        GREEN,
  'Won (Final On-Sale Planned)':              GREEN,
  'Lost':                                     '#FF4444',
}
```

### Career Stage Colors

```typescript
const CAREER_COLORS: Record<string, string> = {
  legendary:   '#ef4444',
  superstar:   '#f97316',
  mainstream:  '#F9D40A',
  'mid-level': '#00D26A',
  developing:  '#4A9EFF',
  undiscovered:'rgba(255,255,255,0.3)',
}
```

### Typography Rules
- No external font imports — use the system font stack already configured in Tailwind
- Use Tailwind's `tracking-wider` and `uppercase` for section labels (consistent with existing UI)
- `font-mono` for numbers, stats, affinity indices, and financial figures
- Heading hierarchy: `text-xl font-bold` → `text-base font-semibold` → `text-sm` → `text-xs`

### Spacing & Layout
- Base padding unit: `p-4` for cards, `p-3` for compact elements
- Card border radius: `rounded-xl` (consistent throughout)
- Section gaps: `gap-6` between major sections, `gap-3` between related items
- Mobile-first: design the mobile layout first, then add `sm:` and `lg:` breakpoints

### Interactive Elements
- All buttons: minimum 44×44px tap target on mobile — use padding, not just font size
- CTAs (primary): `background: Y, color: BG` — Electric Yellow with black text
- Secondary buttons: `border: BORDER, color: W50` with hover state
- Hover states: always add `transition-colors` with a visible but subtle change
- Disabled states: `opacity-50` + `cursor-not-allowed`
- Focus states: visible outline for keyboard accessibility — never `outline-none` without a replacement

### Animation Standards
- **Entrance animations:** cards fade+slide in on load (`opacity-0 → opacity-100`, `translateY(8px) → 0`)
- **Counter animations:** numeric stats count up from 0 on first render (use `requestAnimationFrame`)
- **Chart growth:** bar/donut charts animate width/stroke from 0 to target value on mount
- **Duration:** 200ms for micro-interactions, 400ms for entrance animations, 600ms for chart growth
- **Easing:** `ease-out` for entrances, `ease-in-out` for transitions
- **Principle:** Animate once on entry — do not loop or repeat animations on scroll or re-render
- **Performance:** Prefer `transform` and `opacity` — avoid animating `width`, `height`, or layout properties unless using specific chart grow effects

### Dark Mode
- Always dark — do not implement a light mode toggle
- Background hierarchy: BG → SURFACE → SURFACE2 → SURFACE3 (use this Z-ordering for elevation)
- Never use pure white (`#ffffff`) for text — use `W80` at maximum

---

## Visibility Logic (Critical — do not change without confirming)

Artists are shown/hidden based on their Monday.com stage:

| Stage | Roster visibility | Data accessible |
|-------|-------------------|-----------------|
| Outbound - No Contact | Visible, **visually dimmed** | Yes — full intel |
| Outbound - Automated Contact | Visible, **visually dimmed** | Yes — full intel |
| Prospect and above | Full visibility | Yes |
| Lost | **Hidden entirely** | No |

"Dimmed" means: reduced opacity on the row/card (around `opacity-60`), muted stage badge color (`#666`), no other restrictions. The intelligence tab, contacts, and pitch builder are all still fully functional for outbound artists.

---

## Data Model Reference

### Core Tables (Supabase)

**`artists`** — one row per artist, keyed by `chartmetric_id`  
Key fields: `chartmetric_id`, `name`, `image_url`, `career_stage`, `cm_score`, `primary_genre`, `primary_market`, `spotify_followers`, `spotify_monthly_listeners`, `instagram_followers`, `youtube_subscribers`, `tiktok_followers`, `audience_male_pct`, `audience_female_pct`, `age_13_17_pct` → `age_65_plus_pct`, `audience_ethnicity` (JSONB), `top_countries` (JSONB), `source`, `is_active`, `cm_last_refreshed_at`

**`artist_contacts`** — multiple contacts per artist per role  
Key fields: `chartmetric_id` (FK), `role` ("manager" | "agent" | "business_manager"), `contact_name`, `company_name`, `email`, `phone`, `linkedin_url`, `street`, `city`, `state`, `zip`, `country`, `region` ("NA" | "EU" | "ASIA" | "global"), `source` ("rostr" | "monday" | "manual")

**`monday_items`** — one row per Monday.com board item (one artist can have multiple)  
Key fields: `monday_item_id`, `artist_name`, `chartmetric_id` (FK, nullable), `tour`, `sales_lead`, `stage`, `total_events`, `first_show`, `last_show`, `proj_gross`, `proj_pty_net`, `announce_date`, `pre_sale_date`, `on_sale_date`

**`artist_brand_affinities`** — Chartmetric brand data, only `affinity_scale >= 1.0`  
Key fields: `chartmetric_id` (FK), `brand_id`, `brand_name`, `affinity_scale`, `follower_count`, `interest_category`

**`artist_sector_affinities`** — Chartmetric sector/interest data, only `affinity_scale >= 1.0`  
Key fields: `chartmetric_id` (FK), `sector_id`, `sector_name`, `affinity_scale`

**`festival_appearances`** — festival bookings as discovery signals  
Key fields: `chartmetric_id` (FK), `festival_cm_id`, `festival_name`, `festival_date`, `festival_location`, `festival_size` ("small"|"medium"|"large"|"mega"), `bill_position`, `detected_at`

**`activity_log`** — timeline of signals per artist  
Key fields: `chartmetric_id` (FK), `event_type` ("festival_added"|"album_presave"|"stage_change"|"added_to_pipeline"|"metric_spike"), `event_title`, `event_detail` (JSONB), `event_date` (when the thing happens), `created_at` (when we detected it)

### Key Schema Rules
- `chartmetric_id` is the universal artist key — not name, not UUID
- `chartmetric_id` mapping lives in Supabase only — it is NOT a column on the Monday.com board
- Addresses in `artist_contacts` are stored as structured fields (street/city/state/zip/country), not a single string
- `activity_log` has two date fields: `event_date` (the actual event) and `created_at` (when detected) — both are displayed in the UI

---

## API Integrations

### Monday.com
- **Read only.** We do not write back to Monday in this version (v2.0).
- Monday write-back is a v2.1 feature — requires coordination with Brice (board owner) before any implementation
- Query the Events Deals board; filter by stage on our side (not in the Monday query)
- Source of initial contact data until ROSTR API is available

### Chartmetric
- Auth pattern: follow whatever is already established in the codebase
- No user-facing "Refresh" button — data refresh is via scheduled background jobs only
- API cost awareness: festival list + lineup queries = ~30-40 calls/week; new artist lookups = ~1-5/week
- Only store brand/sector affinities with `affinity_scale >= 1.0`

### Spotify API
- Free tier, rate-limited — use conservatively
- Used for pre-save / upcoming album detection (Phase 2)
- Check `Get Artist Albums` endpoint for future release dates

### Anthropic Claude API (Pitch Builder)
- Model: `claude-sonnet-4-20250514`
- Max tokens: 1000 per pitch response
- All cached artist data (demographics, brand affinities, tour context, festival appearances) passed as context
- **Pitch rules — enforce always:**
  - Never include projected gross revenue figures
  - Never claim a brand has no live music partner
  - Write as a P&TY representative
  - Keep pitches professional, specific to the artist's audience data

### ROSTR
- API access pending — schema is built to accommodate when available
- In the meantime, Monday.com contact fields are the data source
- When ROSTR is available: supplement/replace Monday-sourced contacts, do not duplicate

---

## Navigation Structure

```
/ (root)           → redirect to /roster or /discovery
/discovery         → Discovery view (new artists from festival signals, pre-saves, metric spikes)
/roster            → Roster view (all pipeline artists, sortable table)
/artists/[id]      → Artist detail page (contacts, intelligence, activity, pitch builder)
/admin/export      → Contact export tool (Google Ads, Meta, LinkedIn, CSV)
```

---

## UI Pages & Components

### Discovery View
- Toggle: "New This Week" / "New This Month"
- Card grid: artist image, name, career stage badge, festival chips, management company
- Filters: career stage, genre, festival, signal type (festival / pre-save / metric spike)
- Sort: date added, number of festival appearances, CM score
- Empty state: explain what triggers discovery (requires Phase 2 pipelines)

### Roster View
- Table with columns: Artist, Stage, Tour, Sales Lead, Career Stage, Management Co, # Events, Proj Gross
- Outbound rows: full opacity on hover/click, but default `opacity-60` with muted stage badge
- Lost rows: filtered out entirely — never shown
- Search: by artist name, stage, sales lead, genre, career stage, project type
- Click any row → `/artists/[id]`

### Artist Page (`/artists/[id]`) — reference `page.tsx` for current implementation
Four tabs:
1. **Contacts** — grouped by role (Management / Agency / Business Management), tap-to-email/call on mobile, click-to-copy on desktop, source badge per contact
2. **Intelligence** — demographics (donut + butterfly chart), brand affinities table, sector interests table
3. **Activity** — chronological timeline, dual timestamps (detected + event date)
4. **Pitch Builder** — conversational input → Claude API → formatted output with copy button

Hero section: artist image, name, career stage badge, social stats row with count-up animation, stage badge, tour summary (collapsible)

### Contact Export Tool (`/admin/export`)
- Select artists: individual, filtered group, or all active
- Format options: Google Ads Customer Match, Meta Custom Audiences, LinkedIn Matched Audiences, Raw CSV
- Downloads formatted file ready for direct platform upload
- Not in main navigation — admin/utility section only

---

## Formatting Utilities (already implemented — reuse, do not rewrite)

```typescript
formatNum(n)       // null → '—', 1.2M, 456K, etc.
formatMoney(n)     // null → '—', $1.2M, $297K, etc.
formatPct(n)       // null → '—', '42%'
countryFlag(code)  // 2-letter ISO → emoji flag
formatDate(d)      // 'Mar 2026'
formatDateFull(d)  // 'Mar 18, 2026'
```

These live in the artist page file currently. When other pages need them, extract to `lib/format.ts` — do not duplicate.

---

## Mobile-Specific Requirements

- **Minimum tap target:** 44×44px for all interactive elements
- **Tap-to-email:** `<a href="mailto:...">` on contact email fields
- **Tap-to-call:** `<a href="tel:...">` on contact phone fields
- **No hover-only interactions** — anything that reveals on hover must also work on tap
- **Tables on mobile:** use horizontal scroll (`overflow-x-auto`) or collapse to card layout below `sm:` breakpoint
- **Font sizes:** minimum `text-sm` (14px) for readable content — never `text-xs` for body copy
- **Sticky headers:** roster table header should sticky on scroll for long lists
- **Bottom navigation consideration:** on mobile, tabs on the artist page should be scrollable horizontally if they don't fit — no wrapping

---

## Performance Budget

| Metric | Target |
|--------|--------|
| First Contentful Paint | < 1.5s |
| Largest Contentful Paint | < 2.5s |
| Total Blocking Time | < 100ms |
| Bundle size (initial JS) | < 200kb gzipped |
| API response (artist page) | < 400ms |

Strategies:
- Parallel-fetch all artist page data in a single API route (`/api/artists/[id]` returns artist + brands + sectors + deals + contacts + activity in one request)
- Use `Promise.all` for parallel Supabase queries — never await them sequentially
- Skeleton loading states while data fetches — never show a blank page
- Memoize expensive computations (sorted/filtered affinity tables) with `useMemo`

---

## File Organization

```
/app
  /api
    /artists/[id]/route.ts      ← artist detail endpoint
    /artists/route.ts           ← roster list endpoint
    /discovery/route.ts         ← discovery feed endpoint
    /pitch/route.ts             ← Claude pitch generation endpoint
    /export/route.ts            ← contact export endpoint
  /artists/[id]/page.tsx        ← artist detail page
  /roster/page.tsx              ← roster view
  /discovery/page.tsx           ← discovery view
  /admin/export/page.tsx        ← contact export tool
  layout.tsx                    ← root layout with nav
/lib
  /supabase.ts                  ← Supabase client init
  /chartmetric.ts               ← Chartmetric API helpers
  /monday.ts                    ← Monday.com API helpers
  /format.ts                    ← shared formatting utilities
  /constants.ts                 ← shared color/config constants (when ready)
/types
  /index.ts                     ← shared TypeScript interfaces
/components
  /ui/                          ← reusable primitives (Button, Badge, Spinner, etc.)
  /charts/                      ← DonutChart, ButterflyChart, AffinityTable
  /artist/                      ← ContactCard, TourSummary, ActivityTimeline
```

---

## Naming Conventions

- **Files:** `kebab-case.ts` for utilities, `PascalCase.tsx` for components
- **Components:** PascalCase (`ContactCard`, `ButterflyChart`)
- **Functions/hooks:** camelCase (`formatNum`, `useArtistData`)
- **Constants:** UPPER_SNAKE_CASE for true constants (`Y`, `BG`, `STAGE_COLORS`)
- **Database fields:** snake_case (match Supabase exactly — `chartmetric_id`, `affinity_scale`)
- **API response keys:** snake_case (match database)

---

## Things You Must Never Do

1. **Never overwrite existing Chartmetric data without explicit permission** — When updating artist records, ONLY write to fields that are currently NULL. Never overwrite a non-null value with a new value unless Tim has explicitly approved the overwrite in the current session. This applies to all fields: socials, scores, demographics, genres, images. Use `UPDATE ... SET field = value WHERE field IS NULL` patterns or check existing values before writing.
2. **Never run batch CM API calls without testing on 1-3 artists first** — Always test with a small sample, show Tim the results, get approval, then run the batch. Never run a full sync across all artists without explicit go-ahead.
3. **Never run batch CM API calls that overwrite existing data** — Batch operations should only INSERT new records or UPDATE null fields. If a batch needs to refresh existing data, get Tim's explicit approval first.
4. **Never write back to Monday.com without explicit permission** — Monday write-back is now enabled but each new write pattern must be approved by Tim before running
5. **Never add a user-facing "Refresh Chartmetric" button** — data refresh is admin/cron only
6. **Never include projected gross revenue in pitch output** — enforced in the Claude prompt
7. **Never claim a brand has no live music partner in pitch output** — enforced in the Claude prompt
8. **Never expose API keys in client-side code** — all external API calls go through Next.js API routes
9. **Never use `select('*')` on wide Supabase tables** — always specify columns
10. **Never show Lost-stage artists** — filter them out at the API level, not just the UI
11. **Never use `any` in TypeScript without a justifying comment**
12. **Never use raw `<img>` tags** — always `next/image`
13. **Never break the Monday.com board schema** — `chartmetric_id` stays in Supabase

---

## Data Flow Architecture — CM Pull Rules

CM data is expensive and rarely changes. Follow these rules strictly:

### When CM data is pulled
- **Once per artist, at creation time.** When an artist enters the system (via Monday sync, festival discovery, Add Leads, or Add to Pipeline), run the full 8-call enrichment immediately. After that, the data is static.
- **Never re-pull for existing artists** unless Tim explicitly requests a refresh for specific artists.
- **The daily Monday cron** syncs deals and contacts only. Zero CM calls for artists already in `intel_artists`. CM calls only for genuinely new artists (no `chartmetric_id` linked yet).
- **The weekly festival cron** enriches new discoveries only. Skips artists already in `intel_artists`.

### How to prevent accidental overwrites
- **Always use `/api/sync/chartmetric`** for CM data writes. It has null-strip protection built in. Never write ad-hoc scripts that UPDATE `intel_artists` directly.
- **Any new sync endpoint** must include the null-strip pattern: strip null/undefined values before writing so existing data is never overwritten.
- **Never write ad-hoc batch scripts** that bypass the sync route. If a one-off fix is needed, use the sync route with `?ids=` parameter.
- **Database trigger** protects social/demographic fields from being overwritten when existing value is not null.

### Cost awareness
- Full enrichment = 8 CM calls per artist (profile, career, 4x social stats, brands, sectors)
- Festival lineup query = 1 call per festival
- Monday sync = 0 CM calls (Monday API only) unless new artists found
- Budget: ~30-40 CM calls/week for festival monitoring, ~5-30 for new Monday artists

---

## Phasing Reference

| Phase | Status | Scope |
|-------|--------|-------|
| Phase 1 | In progress | Schema, Monday sync, contact ingestion, Artist page, Roster view, brand affinities, Vercel deploy |
| Phase 2 | Not started | Festival monitor cron, Discovery view, Slack digest, Activity timeline, Contact export |
| Phase 3 | Not started | Pitch builder (Claude API), animated charts, Spotify pre-save monitor |
| Phase 4 (v2.1) | Not started | Monday write-back (coordinate with Brice), ROSTR API, Google Trends |

When working on a feature, confirm which phase it belongs to before building. Do not build Phase 2+ features unless Tim has explicitly requested them in this session.

---

## Open Items (as of March 2026)

- [ ] **ROSTR API access** — pending, Tim coordinating. Schema is ready. When available, populate `artist_contacts` with `source: 'rostr'`
- [ ] **Chartmetric festival lineup endpoint** — confirm exact endpoint using `eventIds` filter on artist live events
- [ ] **Monday.com write-back** — blocked on Brice coordination. Do not implement yet
- [ ] **Festival priority list** — team's list of key US festivals for discovery weighting. Tim has requested from team
- [ ] **Google Trends API** — Tim reaching out. Nice-to-have for household income / in-market data

---

## Session Startup Checklist

At the start of each Claude Code session:
1. Run `git status` — confirm clean working tree before making changes
2. Run `git pull` — ensure you're on latest
3. **Read `docs/chartmetric-api-reference.md`** — refresh on correct endpoints and field names before touching any sync code
4. **Read `docs/monday-data-reference.md`** — refresh on board IDs and column mappings before touching Monday sync
5. **Review "Things You Must Never Do" and "Data Flow Architecture" sections above** — especially rules 1-3 on data protection
6. Ask Tim what specific task(s) to work on this session
7. Check which Phase the task belongs to — don't scope-creep into future phases
8. Confirm any open items above that might affect the task before starting
9. **Before any API call or database write:** state what you're about to do, how many calls it will cost, and wait for Tim's OK

---

## Reference Documents

| Document | Location | Covers |
|----------|----------|--------|
| CLAUDE.md | `/CLAUDE.md` | Architecture, design system, coding standards, data protection rules |
| Chartmetric API Reference | `/docs/chartmetric-api-reference.md` | All CM endpoints, field names, extract patterns, common mistakes |
| Monday Data Reference | `/docs/monday-data-reference.md` | Board IDs, column mappings, contact sync logic, stage visibility |
| Pitch Email Playbook | Claude Project files | Tone, structure, hard rules for AI pitch generation |

**ALWAYS check these docs before writing sync code or API integration code. Never guess at endpoint URLs or field names.**

---

*Last updated: March 26, 2026 — Tim (P&TY)*
