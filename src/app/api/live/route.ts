import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { loadLiveResults, statefulCountries, passesStateFilter } from '@/lib/live-query'

// B4 — drill-down data feed for the /live UI (MULTI-SELECT).
// READ-ONLY against intel_future_shows. Every step is scoped to geo_status='ok'
// (rows we couldn't geo-resolve are never placeable on the date→country→…→city path).
// Selections arrive as repeated query params (countries=US&countries=CA …) and are
// applied as IN-lists. The state step is conditional and handles the mixed case where
// some selected countries have states (US, Canada) and others don't (Germany).
// The results mode delegates to loadLiveResults (shared with the PDF export).
const TABLE = 'intel_future_shows'

// Fetch every geo-ok row in the date range with the requested columns. The table
// is small (~2k rows), so we pull the in-range set once and refine in JS — this
// keeps the IN-list / mixed-state logic readable instead of fighting PostgREST.
async function loadAll(
  client: ReturnType<typeof createServiceClient>,
  columns: string,
  start: string,
  end: string,
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000
  let from = 0
  const out: Record<string, unknown>[] = []
  while (true) {
    const { data, error } = await client
      .from(TABLE)
      .select(columns)
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

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function sortedDistinct(values: (string | null)[]): string[] {
  const set = new Set<string>()
  for (const v of values) if (v) set.add(v)
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const sp = url.searchParams
    const mode = sp.get('mode') ?? 'results'
    const start = sp.get('start')
    const end = sp.get('end')
    if (!start || !end) {
      return NextResponse.json({ error: 'start and end dates are required' }, { status: 400 })
    }

    const countries = sp.getAll('countries')
    const states = sp.getAll('states')
    const cities = sp.getAll('cities')
    const client = createServiceClient()

    if (mode === 'countries') {
      const rows = await loadAll(client, 'country', start, end)
      const list = sortedDistinct(rows.map((r) => str(r.country)))
      // US first (pre-checked in the UI), everything else alphabetical.
      list.sort((a, b) => (a === 'US' ? -1 : b === 'US' ? 1 : a.localeCompare(b)))
      return NextResponse.json({ countries: list })
    }

    const selC = new Set(countries)

    if (mode === 'states') {
      // States that have shows in range within ANY selected country.
      const rows = await loadAll(client, 'country, state', start, end)
      const list = sortedDistinct(
        rows.filter((r) => selC.has(str(r.country) ?? '')).map((r) => str(r.state)),
      )
      return NextResponse.json({ states: list })
    }

    if (mode === 'cities') {
      // Cities within ANY selected (country, state). The mixed stateful/stateless rule
      // is the SHARED predicate (statefulCountries / passesStateFilter) — identical to
      // the results query, so a stateless country (e.g. Denmark, state null) keeps all
      // its cities even when a state is selected for a stateful country (US).
      const rows = await loadAll(client, 'country, state, city', start, end)
      const selS = new Set(states)
      const stateful = statefulCountries(rows, countries)
      const cityVals = rows
        .filter((r) => {
          const c = str(r.country)
          if (!c || !selC.has(c)) return false
          return passesStateFilter(r, selS, stateful)
        })
        .map((r) => str(r.city))
      return NextResponse.json({ cities: sortedDistinct(cityVals) })
    }

    // results — shared with the PDF export so both run the IDENTICAL query.
    const results = await loadLiveResults(client, { start, end, countries, states, cities })
    return NextResponse.json({ results })
  } catch (err) {
    console.error('[live] query failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
