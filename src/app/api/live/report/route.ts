import { createServiceClient } from '@/lib/supabase'
import {
  loadLiveResults,
  groupByCountryThenCity,
  liveArtistKey as artistKey,
  type LiveShowRow,
} from '@/lib/live-query'

// B6 — /live PDF export. Forks the Match Report exporter: standalone HTML route
// handler → window.LIVE_DATA + the measured vanilla-JS paginator. Reuses the Match
// styles.css chrome (masthead/sheet/runhead/career chips) and adds live-report.js +
// live.css for the card/show-list body.
//
// Curation fidelity: re-runs the IDENTICAL Supabase query as the screen (loadLiveResults,
// shared with /api/live), then subtracts the curation deltas the user made on screen —
// removed show ids (rmShow) and removed card ids (rmCard) — so trashed items never reappear.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return s
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

// artistKey is imported from live-query (liveArtistKey) so curation + grouping stay
// identical to the screen.

interface ReportShow {
  date: string
  city: string | null
  state: string | null
  venue: string | null
}
interface ReportCard {
  key: string
  name: string
  image: string | null
  isEvent: boolean
  career: string | null
  shows: ReportShow[]
}
// Two-level by-city payload: country band → cities → cards. A null countryLabel /
// city label means "no header" (by-artist mode emits one such country+city wrapper).
interface ReportCity {
  label: string | null
  cards: ReportCard[]
}
interface ReportCountry {
  countryLabel: string | null
  cities: ReportCity[]
}

function toShow(r: LiveShowRow): ReportShow {
  return { date: fmtDate(r.show_date), city: r.city, state: r.state, venue: r.venue_name }
}

// Build cards (one per artist/event) from a flat row list, sorted by name; shows by date.
function buildCards(rows: LiveShowRow[]): ReportCard[] {
  const map = new Map<string, ReportCard>()
  for (const r of rows) {
    const key = artistKey(r)
    let c = map.get(key)
    if (!c) {
      c = {
        key,
        name: r.artist?.name ?? r.artist_name,
        image: r.artist?.image_url ?? null,
        isEvent: r.chartmetric_id == null,
        career: r.artist?.career_stage ?? null,
        shows: [],
      }
      map.set(key, c)
    }
    c.shows.push(toShow(r))
  }
  for (const c of map.values()) {
    c.shows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function escapeForScript(json: string): string {
  return json.replace(/</g, '\\u003c')
}

function htmlDocument(data: unknown): string {
  const payload = escapeForScript(JSON.stringify(data))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PTY Future Shows</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600;700;800&family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/report/styles.css">
  <link rel="stylesheet" href="/live-report/live.css">
</head>
<body>
  <div id="doc"></div>
  <script>window.LIVE_DATA = ${payload};</script>
  <script src="/live-report/live-report.js"></script>
</body>
</html>`
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const sp = url.searchParams

  const start = sp.get('start')
  const end = sp.get('end')
  if (!start || !end) {
    return new Response('<!doctype html><meta charset="utf-8"><pre>start and end dates are required</pre>', {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const countries = sp.getAll('countries')
  const states = sp.getAll('states')
  const cities = sp.getAll('cities')
  const group = sp.get('group') === 'artist' ? 'artist' : 'city'
  const clientName = (sp.get('client') || '').trim()

  // Curation deltas — repeated params so event names containing commas stay intact.
  const removedShows = new Set(sp.getAll('rmShow').map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n)))
  const removedCards = new Set(sp.getAll('rmCard'))

  try {
    const client = createServiceClient()
    const results = await loadLiveResults(client, { start, end, countries, states, cities })

    // Apply curation: subtract trashed shows and trashed cards (PDF == curated screen).
    const curated = results.filter(
      (r) => !removedShows.has(r.monday_item_id) && !removedCards.has(artistKey(r)),
    )

    const showCount = curated.length
    const cardCount = new Set(curated.map(artistKey)).size

    // By-city → country band → cities → cards (shared with the screen). By-artist is
    // not geographic, so it's a single header-less country+city wrapper.
    const groups: ReportCountry[] =
      group === 'artist'
        ? [{ countryLabel: null, cities: [{ label: null, cards: buildCards(curated) }] }]
        : groupByCountryThenCity(curated, countries, buildCards)

    const scopeParts: string[] = []
    if (countries.length) scopeParts.push(countries.join(', '))
    if (states.length) scopeParts.push(`${states.length} state${states.length === 1 ? '' : 's'}`)
    if (cities.length) scopeParts.push(`${cities.length} cit${cities.length === 1 ? 'y' : 'ies'}`)

    const generated = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

    const data = {
      meta: {
        reportTitle: 'Future Shows',
        client: clientName || 'Future Shows',
        dateRange: `${fmtDate(start)} – ${fmtDate(end)}`,
        scope: scopeParts.join('  ·  ') || '—',
        generated,
        group,
        cardCount,
        showCount,
      },
      groups,
    }

    return new Response(htmlDocument(data), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      `<!doctype html><meta charset="utf-8"><pre>Report error: ${message.replace(/</g, '&lt;')}</pre>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}
