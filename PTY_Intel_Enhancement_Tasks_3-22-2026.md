# PTY Intel — Enhancement Tasks
**Created:** March 2026  
**Status:** Ready for Claude Code  
**Phase:** Post-Phase 1 Polish + Phase 2 prep

---

## How to Use This Document

Each task has a **complexity rating** (S / M / L) and a **priority** (P1 = do first / P2 = do soon / P3 = nice to have). Tackle P1 tasks in order. Do not combine multiple M or L tasks in a single Claude Code session — scope one at a time for clean git commits.

---

## Task List

---

### TASK 01 — Rename All Three Navigation Pages
**Priority:** P1 | **Complexity:** S | **Files:** Nav component, all three page headers + `<title>` tags

**Final names (decided):**
| Old name | New name |
|----------|----------|
| Roster | **Pipeline** |
| Discovery | **Radar** |
| Brand Search | **Match** |

**What to do:**
- Update the nav link labels to Pipeline / Radar / Match
- Update each page's `<h1>` and `<title>` tag to use the new name
- Find and replace all other UI-facing instances of the old names (toasts, empty states, page subtitles, any "go to Discovery" style internal references)
- Update the active state indicator on the nav so it highlights correctly for each renamed route

**Do not change:** File names, folder names, API route paths (`/api/brand-search`, etc.), component names, or variable names — UI-facing text only. A grep for the old names in `.tsx` and `.ts` files will surface everything that needs updating.

---

### TASK 02 — Fix "All Festivals" vs "Most Festivals" Confusion
**Priority:** P1 | **Complexity:** S | **File:** Discovery page filters/sort

**Problem:** Two filter/sort options exist with nearly identical labels that confuse users. It's unclear what the difference is.

**What to do:**
- Audit the Discovery page for every instance of "All Festivals" and "Most Festivals"
- Determine what each actually does in the code (filtering vs. sorting, or a toggle between "show all" and "show multi-festival only")
- Rename them to be unambiguous. Suggested replacements:
  - If it's a **sort**: rename to "Sort: Festival Count" vs. "Sort: Date Added" (or similar)
  - If it's a **filter toggle**: rename to "All Artists" vs. "Multi-Festival Only" (2+ festival appearances)
  - If one is a tab and one is a filter: make that distinction visually clear
- Add a short tooltip or subtitle on the filter explaining what it does (e.g., "Artists booked at 2+ festivals")

---

### TASK 03 — Mobile Touch Improvements (Global)
**Priority:** P1 | **Complexity:** M | **Files:** All pages, shared components

**Problem:** Tap interactions feel unreliable or unresponsive on mobile. Elements are too small or don't give sufficient visual feedback on touch.

**What to do:**

**Tap target sizing:**
- Audit every interactive element (buttons, links, filter chips, tab switchers, row items, contact copy buttons)
- Enforce minimum 44×44px tap target on ALL interactive elements — use padding to expand without changing visual size
- Pay special attention to: nav links, contact copy icons, tab switchers on artist page, filter chips, roster row tap areas, Discovery card tap areas

**Touch feedback:**
- Add `active:` Tailwind states to all tappable elements so there's an immediate visual response on press
- Pattern: `active:opacity-70` for most elements, `active:scale-95` for card-style elements, `active:bg-white/10` for icon buttons
- Do NOT rely on `hover:` states for mobile — every interactive element needs an `active:` equivalent

**Scroll behavior:**
- Ensure horizontal filter chip rows use `-webkit-overflow-scrolling: touch` (or Tailwind's `overflow-x-auto scroll-smooth`)
- Remove any `pointer-events: none` that might be blocking touch events

**Form inputs:**
- All text inputs: add `inputMode` hints where appropriate (e.g., `inputMode="search"` on search fields)
- Prevent iOS zoom on input focus: ensure `font-size` is at least 16px on all inputs (use `text-base` minimum)
- Add `autoCorrect="off" autoCapitalize="off" spellCheck={false}` on search inputs

**Testing note:** After implementation, test on an actual iOS Safari and Android Chrome — not just browser devtools responsive mode.

---

### TASK 04 — Brand Search: Full Redesign
**Priority:** P1 | **Complexity:** L | **File:** `/app/brand-search/page.tsx` (and related API)

**Problem:** The brand search page has a disconnected design that doesn't match the rest of the platform. The search input, filter UI, and results layout all feel like a different product. On mobile, the layout breaks down further.

**What to do — overall layout:**
- Full-width search bar at the top (matches the style of search inputs elsewhere in the app)
- Results display as artist cards consistent with how artists appear on the Pipeline/Roster and Discovery pages — not in a custom one-off layout
- The match score (demographic %, brand affinity) should appear as data overlays on the card, not as the primary design element

**Desktop layout:**
- Search + filters: sticky top bar with brand search input (full width) + filter controls inline
- Results: 2–3 column card grid matching Discovery page card style
- Each card shows: artist photo, name, career stage badge, genre, match % (green), brand affinity index (yellow), CM score
- Hovering a card should reveal a quick-action row: "View Artist" and a checkbox for multi-select

**Mobile layout:**
- Search input: full width, prominent, at top
- Filters: collapsible drawer (same pattern as Discovery mobile filter drawer)
- Results: compact list rows — NOT cards. Each row: artist thumbnail (small, square), name + career stage badge, match % + affinity score. Tap row → artist page. This matches the screenshot feedback requesting "smaller rows with essential info."
- The current screenshot (IMG_5183) shows this general direction — names are truncated (`Centra...`, `Don Tol...`) which is a problem; fix truncation so full names show or use a slightly wider layout

**Fix name truncation:** Artist names are currently cutting off at ~8 characters. This is unacceptable. Fix by allowing the name container to be wider, or reduce the font size slightly, or move the stats to a second line on mobile.

---

### TASK 05 — Brand Search: Replace Guessed Brands with Real Data
**Priority:** P1 | **Complexity:** M | **File:** Brand search input component + `/api/brands` route

**Problem:** The brand autocomplete currently guesses brand names. Users have no confidence in the results because they don't know what brands are actually in the system.

**What to do:**
- Build an alphabetized, browseable brand list from the actual `artist_brand_affinities` table
- Pre-load all distinct `brand_name` values from the database (grouped by `interest_category`)
- Replace the current autocomplete-only input with a two-mode interface:
  - **Mode 1 — Browse:** A categorized list panel that opens below the search input, showing brands grouped by `interest_category` (e.g., "Automotive," "Apparel," "Beverage," "Tech," etc.), sorted alphabetically within each category. Each brand shows a small artist count badge.
  - **Mode 2 — Search:** Typing in the input filters the categorized list in real-time. The list doesn't disappear — it narrows.
- On mobile: the brand browser opens as a bottom sheet / drawer
- On desktop: the brand browser opens as a dropdown panel (max-height ~400px, scrollable)
- Once a brand is selected, it appears as a removable chip above the results and the panel closes

**API change needed:** Update `/api/brands` route to return all brands grouped by category, not just autocomplete matches. Cache this response (it won't change frequently).

---

### TASK 06 — Brand Search Results: Add Career Stage Filter
**Priority:** P2 | **Complexity:** S | **File:** Brand search results filter bar

**Problem:** Results currently sort/filter by CM Score. Career stage is more meaningful to the sales team for deciding who to pursue.

**What to do:**
- Add a career stage filter to the brand search results (same filter chips used elsewhere: Undiscovered / Developing / Mid-Level / Mainstream / Superstar / Legendary)
- Display career stage badge prominently on each result card/row
- Make career stage the default visible sort criterion (replace CM Score as primary display)
- Keep CM Score visible but secondary (smaller, muted)
- Filter chips should be horizontally scrollable on mobile

---

### TASK 07 — Brand Search: Multi-Select + Pitch/Summary Export
**Priority:** P2 | **Complexity:** L | **File:** Brand search results + new export/pitch modal

**Problem:** Once a user finds a list of matching artists, there's no action to take. The feature is read-only with no workflow output.

**What to do:**
- Add checkbox selection to each artist result card/row (tap the checkbox or long-press on mobile)
- Show a persistent "selected" bar at the bottom of the screen when ≥1 artist is selected: "[X] artists selected — Create Pitch | Create Summary | Clear"
- **Create Pitch:** Opens a modal. User picks pitch type (VIP Sales / Brand Partnership) and writes a brief description of the brand. Sends selected artists + brand context to Claude API. Returns a multi-artist pitch document formatted for copy-paste into email or deck.
- **Create Summary:** Generates a concise comparison table of selected artists — name, career stage, key demographic, top brand affinity, Spotify reach — formatted as clean text or downloadable CSV.
- The bottom action bar should be sticky and not obstruct scrolling (use `position: fixed, bottom: 0` with padding compensation on the list)
- On mobile: the action bar sits above the bottom of the screen with a safe area inset

**Pitch rules (same as single-artist pitch builder):**
- Never include projected gross revenue
- Never claim a brand has no live music partner
- Write as P&TY representatives

---

### TASK 08 — User Logins + Monday.com Sales Lead Mapping
**Priority:** P2 | **Complexity:** L | **Files:** Auth, new users table, "Add to Monday" flow

**Problem:** The platform currently uses a shared password. There are no individual user accounts, so there's no way to attribute actions (like "Add to Monday") to a specific person.

**What to do:**

**Auth upgrade:**
- Replace shared Vercel middleware password with Supabase Auth (email + password, or magic link)
- Each user has an account with: name, email, role ("sales" | "brand_partnerships" | "admin")
- Keep it simple — no SSO yet, just email/password

**Monday.com sales lead mapping:**
- Add a `monday_user_name` field to the users table — this is the exact string that appears as "Sales Lead" on the Monday.com board
- When a user logs in, their `monday_user_name` is available in session context
- When "Add to Monday" is triggered (v2.1 feature), pre-populate the Sales Lead field with the logged-in user's `monday_user_name`
- In the current phase (read-only Monday), surface the user's name in the UI as their identity badge in the nav — no Monday write-back yet

**Nav update:**
- Show logged-in user's name/avatar in top nav (right side)
- Add sign-out option

**Important:** Do NOT implement Monday write-back as part of this task. That is Task 09 / v2.1 scope. This task only sets up the auth infrastructure and the Monday name mapping field.

---

### TASK 09 — Deal Stage Dropdown: Fix Sort Order
**Priority:** P1 | **Complexity:** S | **File:** Any component rendering stage options in a `<select>` or dropdown

**Problem:** Deal stages in dropdowns appear in a non-logical order, making it confusing to navigate.

**What to do:**
- Find every place in the UI where deal stages are rendered as dropdown/select options
- Enforce this canonical order everywhere:
  1. Outbound - No Contact
  2. Outbound - Automated Contact
  3. Prospect - Direct Sales Agent Contact
  4. Active Leads (Contact Has Responded)
  5. Proposal (financials submitted)
  6. Negotiation (Terms Being Discussed)
  7. Finalizing On-Sale (Terms Agreed)
  8. Won (Final On-Sale Planned)
  9. Lost
- Create a `STAGE_ORDER` constant array in `lib/constants.ts` with this order and import it everywhere stages are sorted/displayed — do not hardcode the order in multiple places

---

### TASK 10 — Mobile: Compact Artist Rows on Pipeline + Discovery
**Priority:** P2 | **Complexity:** M | **Files:** Pipeline page, Radar page (mobile breakpoint)

**Problem:** On mobile, artist cards on the Pipeline and Radar pages take up too much vertical space. Users have to scroll a lot to see their full roster. The brand search results mobile layout (compact rows) is the right direction — apply it consistently.

**What to do:**
- On screens below `md` breakpoint, replace card grid layout with a compact list-row layout on both Pipeline and Radar pages
- Each row: small square artist thumbnail (40×40px), name (full, not truncated) + career stage badge, one or two key stats (e.g., stage + tour OR festival count + CM score)
- Tap anywhere on the row → artist page
- Row height: ~60–64px
- Keep the desktop card grid layout unchanged — this is a mobile-only change
- Use the same `active:bg-white/5` touch feedback on rows

---

### TASK 11 — Brand Search Results: Visual Cleanup
**Priority:** P1 | **Complexity:** S | **File:** Brand search results component

**Problem:** Results are visually noisy. Multiple data points compete for attention. Genre label, market data, and score overlap in the current layout (visible in screenshot).

**What to do:**
- Establish a clear visual hierarchy per result:
  - **Primary:** Artist name (full, never truncated on any screen size)
  - **Secondary:** Career stage badge + genre
  - **Tertiary:** Match % (green) + Brand affinity (yellow) — these are the two key numbers, give them space
  - **Score:** CM score badge — smaller, right-aligned, muted
- Remove any overlapping text (genre label was overlapping the demographic % in the screenshot)
- Ensure genre and market labels don't collide with data values
- Tighten spacing so more results are visible without scrolling

---

## Implementation Order (Recommended)

**Session 1 (Quick wins — all S complexity):**
- Task 09: Fix stage dropdown order
- Task 02: Fix "All Festivals" / "Most Festivals" labeling
- Task 11: Brand search results visual cleanup
- Task 01: Name the brand search feature (after Tim decides on name)

**Session 2:**
- Task 03: Mobile touch improvements (global)

**Session 3:**
- Task 05: Brand search — real brand data with browse/search

**Session 4:**
- Task 04: Brand search full redesign (desktop + mobile)

**Session 5:**
- Task 06: Career stage filter on brand search results
- Task 10: Compact mobile rows on Pipeline + Radar

**Session 6:**
- Task 07: Multi-select + pitch/summary export

**Session 7:**
- Task 08: User logins + Monday sales lead mapping

---

## Decision Needed from Tim Before Building

| # | Decision | Affects |
|---|----------|---------|
| D1 | For the "All/Most Festivals" issue — is this a sort or a filter, and what should the two options actually mean? | Task 02 |
| D3 | For user auth — magic link (easier) or email/password (more familiar)? | Task 08 |
| D4 | For brand search browse panel — should categories come from Chartmetric's `interest_category` field as-is, or should we rename/merge some? | Task 05 |

---

*Last updated: March 2026 — Tim (P&TY)*
