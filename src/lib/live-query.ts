import { createServiceClient } from '@/lib/supabase'

// Shared results query for the /live feature. Used by BOTH the drill-down feed
// (/api/live, results mode) and the PDF export (/api/live/report) so the exported
// document is guaranteed to run the IDENTICAL query as the on-screen results —
// curation deltas are then applied on top by the caller. Keeping this in one place
// is what makes "PDF == curated screen" hold.
const TABLE = 'intel_future_shows'

const RESULT_COLUMNS =
  'id, monday_item_id, artist_name, chartmetric_id, match_status, show_date, venue_name, city, state, country, full_address'

export interface LiveArtistInfo {
  name: string
  image_url: string | null
  career_stage: string | null
}

export interface LiveShowRow {
  id: number
  monday_item_id: number
  artist_name: string
  chartmetric_id: number | null
  match_status: string
  show_date: string | null
  venue_name: string | null
  city: string | null
  state: string | null
  country: string | null
  full_address: string | null
  artist: LiveArtistInfo | null
}

export interface LiveQueryParams {
  start: string
  end: string
  countries: string[]
  states: string[]
  cities: string[]
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

// ── The stateful/stateless state-filter rule — DEFINED ONCE ───────────────────
// CRITICAL: every query path that filters by selected state (the city step in
// /api/live AND the results query below) MUST call these two helpers. Do NOT
// re-inline this logic. It has regressed three separate times precisely because it
// was re-implemented per-path; keeping it in one place is the durable fix.
//
// "Stateful" selected countries = those with >=1 non-null state among the in-range
// rows of the current selection (US, Canada). "Stateless" = none in range (Denmark,
// Czechia, Germany — state is null). The rule is:
//   keep a row when  (country is stateful AND its state is a selected state)
//                    OR  (country is stateless)
// A stateless country is NEVER filtered by the selected-state list — that is the bug
// that keeps recurring (a flat `state IN (...)` drops every null-state row).

// Which selected countries are "stateful" (have >=1 non-null state in this row set).
export function statefulCountries(
  rows: ReadonlyArray<{ country?: unknown; state?: unknown }>,
  selectedCountries: Iterable<string>,
): Set<string> {
  const selC = new Set(selectedCountries)
  const sf = new Set<string>()
  for (const r of rows) {
    const cc = str(r.country)
    if (cc && selC.has(cc) && str(r.state)) sf.add(cc)
  }
  return sf
}

// Does this row pass the selected-state constraint? `stateful` comes from
// statefulCountries(). Stateless countries always pass; an empty selected-state set
// imposes no constraint (defensive — in the real flow that only co-occurs with an
// empty stateful set anyway).
export function passesStateFilter(
  row: { country?: unknown; state?: unknown },
  selectedStates: ReadonlySet<string>,
  stateful: ReadonlySet<string>,
): boolean {
  const cc = str(row.country)
  if (cc == null) return false
  if (!stateful.has(cc)) return true // stateless selected country → never state-filtered
  if (selectedStates.size === 0) return true
  const s = str(row.state)
  return s != null && selectedStates.has(s) // stateful → must match a selected state
}

// ── Career-stage filter — DEFINED ONCE (same discipline as the state rule) ────
// Canonical tiers, EXACTLY the lowercase values stored in intel_artists. Display casing
// differs across the app — NEVER filter against a Title-Cased label (the Export Report
// "Mid-Level" vs DB "mid-level" mismatch silently matched nothing). These ARE the DB values.
export const LIVE_CAREER_STAGES = [
  'legendary',
  'superstar',
  'mainstream',
  'mid-level',
  'developing',
  'undiscovered',
] as const

// Does this row's artist pass the selected career-stage filter? Shared by the results
// screen and the PDF export so both stay identical. Empty selection = no filter. EVENT
// cards (unmatched, chartmetric_id null → null career stage) ALWAYS pass — artist-tier
// filtering doesn't apply to non-artist events, and silently dropping null-stage rows is
// the same null-trap as the stateless-state bug. Do NOT re-inline a flat "stage IN selected".
export function passesStageFilter(
  careerStage: string | null | undefined,
  selectedStages: ReadonlySet<string>,
): boolean {
  if (selectedStages.size === 0) return true
  if (careerStage == null) return true // EVENT / unmatched → always shown
  return selectedStages.has(careerStage.toLowerCase())
}

// Pull every geo-ok row in the date range (table is ~2k rows), refine in JS.
async function loadAll(
  client: ReturnType<typeof createServiceClient>,
  start: string,
  end: string,
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000
  let from = 0
  const out: Record<string, unknown>[] = []
  while (true) {
    const { data, error } = await client
      .from(TABLE)
      .select(RESULT_COLUMNS)
      .eq('geo_status', 'ok')
      .gte('show_date', start)
      .lte('show_date', end)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as unknown as Record<string, unknown>[]
    out.push(...batch)
    if (batch.length < PAGE) break
    from += PAGE
  }
  return out
}

// Rows matching selected countries AND states AND cities (IN-lists), joined to
// intel_artists. The selected-state constraint applies ONLY to stateful countries;
// stateless countries (e.g. Czechia, Germany — state null) pass through.
export async function loadLiveResults(
  client: ReturnType<typeof createServiceClient>,
  params: LiveQueryParams,
): Promise<LiveShowRow[]> {
  const { start, end, countries, states, cities } = params
  const selC = new Set(countries)
  const selS = new Set(states)
  const selCity = new Set(cities)

  const rows = (await loadAll(client, start, end)) as unknown as LiveShowRow[]

  // Single source of the stateful/stateless rule (see statefulCountries / passesStateFilter).
  const stateful = statefulCountries(rows, countries)
  const filtered = rows.filter((r) => {
    if (r.country == null || !selC.has(r.country)) return false
    if (r.city == null || !selCity.has(r.city)) return false
    return passesStateFilter(r, selS, stateful)
  })

  const ids = Array.from(
    new Set(filtered.map((r) => r.chartmetric_id).filter((x): x is number => x != null)),
  )
  const artistMap = new Map<number, LiveArtistInfo>()
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await client
      .from('intel_artists')
      .select('chartmetric_id, name, image_url, career_stage')
      .in('chartmetric_id', ids.slice(i, i + 500))
    if (error) throw new Error(error.message)
    for (const a of data ?? []) {
      artistMap.set(a.chartmetric_id, {
        name: a.name,
        image_url: a.image_url,
        career_stage: a.career_stage,
      })
    }
  }

  return filtered.map((r) => ({
    ...r,
    artist: r.chartmetric_id != null ? artistMap.get(r.chartmetric_id) ?? null : null,
  }))
}

// ── Shared grouping/labeling (used by BOTH the screen and the PDF export) ──────
// These live here so the on-screen results and the exported PDF group, order, and
// label identically. Don't duplicate this logic in either consumer.

// Stored country codes/abbreviations → full client-facing display names. Anything
// not listed renders as-is (most rows already store a full country name).
const COUNTRY_DISPLAY: Record<string, string> = {
  US: 'United States',
  USA: 'United States',
  UK: 'United Kingdom',
  UAE: 'United Arab Emirates',
}

export function countryDisplay(code: string | null | undefined): string {
  if (!code) return 'Unknown'
  return COUNTRY_DISPLAY[code] ?? code
}

// "Brooklyn, NY" (stateful) or "Kowloon City" (stateless). Operates on the shared
// row shape; only city/state are read.
export function liveCityLabel(r: { city: string | null; state: string | null }): string {
  const city = r.city ?? 'Unknown city'
  return r.state ? `${city}, ${r.state}` : city
}

// Stable per-artist/event key. Unmatched (no profile) keyed by name → event card.
export function liveArtistKey(r: { chartmetric_id: number | null; artist_name: string }): string {
  return r.chartmetric_id != null ? `cm:${r.chartmetric_id}` : `ev:${r.artist_name}`
}

// Country order: US first (the usual bulk), then the user's selected-country order,
// then any remaining present countries alphabetically. Only countries present in the
// result set are emitted.
function orderCountries(present: string[], selected: string[]): string[] {
  const presentSet = new Set(present)
  const out: string[] = []
  const pushed = new Set<string>()
  const add = (c: string) => {
    if (presentSet.has(c) && !pushed.has(c)) {
      out.push(c)
      pushed.add(c)
    }
  }
  add('US')
  for (const c of selected) add(c)
  present.filter((c) => !pushed.has(c)).sort((a, b) => a.localeCompare(b)).forEach(add)
  return out
}

export interface LiveCountryGroup<Card> {
  country: string // raw stored code (e.g. 'US'); 'Unknown' for null
  countryLabel: string // client-facing display name
  cities: { label: string; cards: Card[] }[]
}

// Two-level grouping for BY-CITY mode: country section → cities within (alphabetical)
// → cards within (built + sorted by the caller's buildCards). Generic over the row
// type so both the screen (ResultRow) and the export (LiveShowRow) share it.
export function groupByCountryThenCity<
  R extends { country: string | null; city: string | null; state: string | null },
  Card,
>(rows: R[], selectedOrder: string[], buildCards: (rows: R[]) => Card[]): LiveCountryGroup<Card>[] {
  const byCountry = new Map<string, Map<string, R[]>>()
  for (const r of rows) {
    const cc = r.country ?? 'Unknown'
    let cities = byCountry.get(cc)
    if (!cities) {
      cities = new Map<string, R[]>()
      byCountry.set(cc, cities)
    }
    const cl = liveCityLabel(r)
    const arr = cities.get(cl)
    if (arr) arr.push(r)
    else cities.set(cl, [r])
  }
  return orderCountries(Array.from(byCountry.keys()), selectedOrder).map((cc) => {
    const cities = byCountry.get(cc)!
    return {
      country: cc,
      countryLabel: countryDisplay(cc),
      cities: Array.from(cities.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, cityRows]) => ({ label, cards: buildCards(cityRows) })),
    }
  })
}
