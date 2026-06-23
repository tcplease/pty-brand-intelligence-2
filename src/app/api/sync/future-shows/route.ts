import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { parseVenue, matchArtist, normalizeArtistName } from '@/lib/future-shows'

// Board 5517797966 — "Future Shows - Count, Close & Data Automations".
// DIFFERENT board than the deals board (2696356486) that feeds intel_artists.
// READ-ONLY: we never write back here.
const BOARD_ID = '5517797966'
const FUTURE_SHOWS_GROUP_TITLE = 'Future Shows'
const DATE_COL = 'date4' // "Date"
const VENUE_COL = 'location_1__1' // "Venue" (Monday location column; .text = comma blob)

const PAGE_LIMIT = 100
const UPSERT_BATCH = 200

interface MondayItem {
  id: string
  name: string
  column_values: { id: string; text: string | null }[]
}

async function mondayQuery(query: string) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MONDAY_API_TOKEN}`,
      'API-Version': '2023-10',
    },
    body: JSON.stringify({ query }),
  })
  const json = await res.json()
  if (json.errors) throw new Error(`Monday API error: ${JSON.stringify(json.errors)}`)
  return json.data
}

// Resolve the "Future Shows" group id by title (don't hardcode the opaque id).
async function findGroupId(): Promise<string> {
  const data = await mondayQuery(`{ boards(ids: ${BOARD_ID}) { groups { id title } } }`)
  const groups: { id: string; title: string }[] = data.boards?.[0]?.groups ?? []
  const group = groups.find((g) => g.title.trim() === FUTURE_SHOWS_GROUP_TITLE)
  if (!group) {
    throw new Error(
      `Group "${FUTURE_SHOWS_GROUP_TITLE}" not found on board ${BOARD_ID}. ` +
        `Groups: ${groups.map((g) => g.title).join(', ')}`,
    )
  }
  return group.id
}

// Cursor-paginate items within the Future Shows group only (not the whole board).
async function fetchGroupItems(groupId: string): Promise<MondayItem[]> {
  const cols = `["${DATE_COL}", "${VENUE_COL}"]`
  const all: MondayItem[] = []

  const first = await mondayQuery(`{
    boards(ids: ${BOARD_ID}) {
      groups(ids: ["${groupId}"]) {
        items_page(limit: ${PAGE_LIMIT}) {
          cursor
          items { id name column_values(ids: ${cols}) { id text } }
        }
      }
    }
  }`)

  let page = first.boards?.[0]?.groups?.[0]?.items_page
  all.push(...(page?.items ?? []))
  let cursor: string | null = page?.cursor ?? null

  while (cursor) {
    const next = await mondayQuery(`{
      next_items_page(limit: ${PAGE_LIMIT}, cursor: "${cursor}") {
        cursor
        items { id name column_values(ids: ${cols}) { id text } }
      }
    }`)
    page = next.next_items_page
    all.push(...(page?.items ?? []))
    cursor = page?.cursor ?? null
  }

  return all
}

async function runSync() {
  const client = createServiceClient()

  // 1. Build artist match maps from intel_artists (paginated; >1000 rows).
  const artists = await fetchArtists(client)
  const exactMap = new Map<string, number>()
  const normMap = new Map<string, number>()
  for (const a of artists) {
    if (!a.name) continue
    exactMap.set(a.name.toLowerCase().trim(), a.chartmetric_id)
    normMap.set(normalizeArtistName(a.name), a.chartmetric_id)
  }

  // 2. Pull Future Shows group items.
  const groupId = await findGroupId()
  const items = await fetchGroupItems(groupId)

  // 3. Parse + match + assemble rows.
  const now = new Date().toISOString()
  const unmatchedNames = new Set<string>()
  let unknownGeo = 0
  const matchCache = new Map<string, ReturnType<typeof matchArtist>>()

  const rows = items.map((item) => {
    const venueBlob = item.column_values.find((c) => c.id === VENUE_COL)?.text ?? null
    const dateText = item.column_values.find((c) => c.id === DATE_COL)?.text ?? null
    const venue = parseVenue(venueBlob)
    if (venue.geo_status === 'unknown') unknownGeo++

    const name = item.name?.trim() ?? ''
    let match = matchCache.get(name)
    if (!match) {
      match = matchArtist(name, exactMap, normMap)
      matchCache.set(name, match)
    }
    if (match.match_status === 'unmatched' && name) unmatchedNames.add(name)

    return {
      monday_item_id: parseInt(item.id, 10),
      artist_name: name,
      chartmetric_id: match.chartmetric_id,
      match_status: match.match_status,
      show_date: dateText || null,
      venue_name: venue.venue_name,
      city: venue.city,
      state: venue.state,
      country: venue.country,
      geo_status: venue.geo_status,
      full_address: venue.full_address,
      monday_last_synced_at: now,
      updated_at: now,
    }
  })

  // 4. Upsert in batches keyed on monday_item_id.
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    const { error } = await client
      .from('intel_future_shows')
      .upsert(batch, { onConflict: 'monday_item_id' })
    if (error) throw new Error(`intel_future_shows upsert error: ${error.message}`)
  }

  const summary = {
    rows_synced: rows.length,
    unmatched_artists: unmatchedNames.size,
    geo_unknown: unknownGeo,
  }
  console.log(
    `[future-shows] synced=${summary.rows_synced} unmatched=${summary.unmatched_artists} geo_unknown=${summary.geo_unknown}`,
  )

  return NextResponse.json({
    ok: true,
    ...summary,
    unmatched_names: Array.from(unmatchedNames).sort(),
  })
}

// Paginate intel_artists (Supabase caps responses at 1000 rows).
async function fetchArtists(client: ReturnType<typeof createServiceClient>) {
  const PAGE = 1000
  let from = 0
  const rows: { chartmetric_id: number; name: string }[] = []
  while (true) {
    const { data, error } = await client
      .from('intel_artists')
      .select('chartmetric_id, name')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`intel_artists paged fetch error: ${error.message}`)
    rows.push(...((data as { chartmetric_id: number; name: string }[]) || []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return rows
}

// Vercel cron entry — authenticated.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return await runSync()
  } catch (err) {
    console.error('[future-shows] sync failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Manual "Refresh" trigger from /live (admin). Open, mirrors other sync routes.
export async function POST() {
  try {
    return await runSync()
  } catch (err) {
    console.error('[future-shows] sync failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
