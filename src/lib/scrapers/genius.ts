// Genius release calendar scrapers (albums + singles), via api.genius.com.
// Direct page scraping is blocked from Vercel datacenter IPs by Cloudflare,
// but the API is reachable with a Bearer token (GENIUS_ACCESS_TOKEN env var).
//
// Strategy:
//   1. /search?q=<Month> <year> <kind> Release Calendar to find the song_id
//      for each monthly calendar.
//   2. /referents?song_id=<id>&per_page=50 (paginated) to pull every entry.
//      Each referent has a `fragment` like "Artist - Album - X/Y" (X/Y is
//      the Genius transcription counter, ignored).
//   3. Use the song's `release_date_for_display` ("January 2026") to derive
//      a month-level date. The API does not expose the per-day <b>M/D</b>
//      headers from the rendered page, so all entries from one month song
//      get YYYY-MM-01. Acceptable for Radar's window-based surfacing.

import type { CalendarRelease } from './billboard'

const API_BASE = 'https://api.genius.com'

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const

type Kind = 'album' | 'single'

interface GeniusSearchHit {
  type: string
  result?: {
    id: number
    full_title?: string
    artist_names?: string
    release_date_for_display?: string
    api_path?: string
  }
}

interface GeniusReferent {
  id: number
  fragment?: string
  song_id?: number
  range?: { content?: string }
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
}

async function geniusGet<T>(path: string, token: string, timeoutMs = 15000): Promise<T | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(token), signal: ctrl.signal })
    if (!res.ok) {
      console.warn(`[genius-api] ${res.status} ${path}`)
      return null
    }
    const json = (await res.json()) as { response?: T }
    return json.response ?? null
  } catch (err) {
    console.warn(`[genius-api] fetch failed ${path}:`, err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(t)
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Search for a calendar song and return its id + display date. */
async function findCalendarSong(
  year: number,
  month: typeof MONTHS[number],
  kind: Kind,
  token: string,
): Promise<{ id: number; release_date_for_display: string | null } | null> {
  const noun = kind === 'album' ? 'Album' : 'Singles'
  const q = `${capitalize(month)} ${year} ${noun} Release Calendar`
  const r = await geniusGet<{ hits: GeniusSearchHit[] }>(
    `/search?q=${encodeURIComponent(q)}`,
    token,
  )
  if (!r?.hits) return null
  for (const hit of r.hits) {
    if (hit.type !== 'song') continue
    const result = hit.result
    if (!result?.id) continue
    const title = (result.full_title ?? '').toLowerCase()
    const artistNames = (result.artist_names ?? '').toLowerCase()
    const matchesMonth = title.includes(month)
    const matchesYear = title.includes(String(year))
    const matchesKind = kind === 'album'
      ? (title.includes('album') && !title.includes('singles'))
      : title.includes('singles')
    const matchesCalendar = title.includes('release calendar')
    const byGenius = artistNames === 'genius' || title.includes('by genius')
    if (matchesMonth && matchesYear && matchesKind && matchesCalendar && byGenius) {
      return {
        id: result.id,
        release_date_for_display: result.release_date_for_display ?? null,
      }
    }
  }
  return null
}

/** Pull all referents for a song, paginated until exhausted. */
async function fetchAllReferents(songId: number, token: string): Promise<GeniusReferent[]> {
  const out: GeniusReferent[] = []
  let page = 1
  while (true) {
    const r = await geniusGet<{ referents: GeniusReferent[] }>(
      `/referents?song_id=${songId}&per_page=50&page=${page}&text_format=plain`,
      token,
    )
    const items = r?.referents ?? []
    if (items.length === 0) break
    out.push(...items)
    if (items.length < 50) break
    page++
    if (page > 20) break // safety cap
    await sleep(200)
  }
  return out
}

/** Parse "Artist - Album - X/Y" fragment text. */
export function parseReferentFragment(fragment: string): { artist: string; album: string } | null {
  if (!fragment) return null
  // Strip trailing " - X/Y" counter
  const stripped = fragment.replace(/\s+[-—]\s+\d+\/\d+\s*$/, '').trim()
  // Split on " - " or " — " (first segment is artist, rest is album).
  const parts = stripped.split(/\s+[-—]\s+/)
  if (parts.length < 2) return null
  const artist = parts[0].trim()
  const album = parts.slice(1).join(' - ').trim()
  if (!artist || !album) return null
  return { artist, album }
}

/** "January 2026" -> "2026-01-01". Falls back to (year, monthIdx) on parse fail. */
function displayMonthToIsoDate(display: string | null, year: number, monthIdx: number): string {
  if (display) {
    const m = display.match(/^([A-Za-z]+)\s+(\d{4})$/)
    if (m) {
      const monthName = m[1].toLowerCase()
      const yr = parseInt(m[2], 10)
      const idx = MONTHS.indexOf(monthName as typeof MONTHS[number]) + 1
      if (idx > 0 && yr) return `${yr}-${String(idx).padStart(2, '0')}-01`
    }
  }
  return `${year}-${String(monthIdx).padStart(2, '0')}-01`
}

interface ScrapeOptions {
  year: number
  kind: Kind
  /** Optional: limit to specific month indices 1-12. */
  months?: number[]
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Top-level: API-driven scrape across the 12 monthly calendar songs. */
export async function scrapeGenius(opts: ScrapeOptions): Promise<{
  releases: CalendarRelease[]
  pagesFetched: number
  pagesFailed: number
}> {
  const token = process.env.GENIUS_ACCESS_TOKEN
  if (!token) {
    console.warn('[genius-api] missing GENIUS_ACCESS_TOKEN — returning 0 entries')
    return { releases: [], pagesFetched: 0, pagesFailed: 12 }
  }

  const monthIndices = opts.months ?? Array.from({ length: 12 }, (_, i) => i + 1)
  const source = opts.kind === 'album' ? 'genius_album' : 'genius_single'
  const all: CalendarRelease[] = []
  let pagesFetched = 0
  let pagesFailed = 0

  for (const monthIdx of monthIndices) {
    const monthName = MONTHS[monthIdx - 1]
    const song = await findCalendarSong(opts.year, monthName, opts.kind, token)
    if (!song) {
      pagesFailed++
      continue
    }
    pagesFetched++
    const isoDate = displayMonthToIsoDate(song.release_date_for_display, opts.year, monthIdx)
    const sourceUrl = `https://genius.com/Genius-${monthName}-${opts.year}-${opts.kind === 'album' ? 'album' : 'singles'}-release-calendar-annotated`

    const referents = await fetchAllReferents(song.id, token)
    for (const ref of referents) {
      const fragment = ref.fragment ?? ref.range?.content ?? ''
      const parsed = parseReferentFragment(fragment)
      if (!parsed) continue
      all.push({
        source,
        source_url: sourceUrl,
        artist_name_raw: parsed.artist,
        album_name: parsed.album,
        release_date: isoDate,
        release_type: opts.kind,
        raw_payload: {
          month: monthName,
          song_id: song.id,
          referent_id: ref.id,
          fragment,
        },
      })
    }
    await sleep(150)
  }

  return { releases: all, pagesFetched, pagesFailed }
}
