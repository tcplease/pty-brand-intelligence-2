// ── Pitchfork "New Music Releases and Upcoming Albums" scraper ───
// Source: https://pitchfork.com/news/new-album-releases/
//
// Pitchfork maintains a single rolling article that lists upcoming
// releases grouped by date. Plain text body, easy to parse:
//
//   May 5
//   Alabaster DePlume: Dear Children of Our Children, ... [International Anthem]
//   Aldous Harding: Train on the Island [4AD]
//   May 8
//   Basement: Wired [Run For Cover]
//   ...
//
// Date headers are bare "Month D" lines. Entries are "Artist: Album [Label]"
// where Artist may contain ", and ", "&", "feat." etc.
//
// No LLM needed — strict regex pass handles >95% of entries cleanly.

import * as cheerio from 'cheerio'
import type { CalendarRelease } from './billboard'

const URL = 'https://pitchfork.com/news/new-album-releases/'

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

export async function fetchPitchforkHtml(timeoutMs = 20000): Promise<string | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(URL, { headers: BROWSER_HEADERS, signal: ctrl.signal })
    if (!res.ok) {
      console.warn(`[pitchfork] ${res.status} fetching ${URL}`)
      return null
    }
    return await res.text()
  } catch (err) {
    console.warn('[pitchfork] fetch failed:', err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(t)
  }
}

/** Extract the article body text from a Pitchfork article page. */
export function extractArticleText(html: string): string {
  const $ = cheerio.load(html)
  // The article body lives inside data-testid="ArticlePageChunks" or
  // "BodyWrapper". Cheerio with attribute selector pulls it out.
  let body = $('[data-testid="ArticlePageChunks"]').text()
  if (!body) body = $('[data-testid="BodyWrapper"]').text()
  if (!body) {
    // Fallback: full <article>
    body = $('article').first().text()
  }
  return body
}

/** Detect "Month D" / "Month Day" date headers as standalone lines. */
export function parsePitchforkDate(line: string, year: number): string | null {
  const trimmed = line.trim()
  // Standalone date: "May 5" or "Sept. 12" — must be just month + day
  const m = trimmed.match(/^([A-Za-z]+)\.?\s+(\d{1,2})$/)
  if (!m) return null
  const monthStr = m[1].toLowerCase()
  const month = MONTH_MAP[monthStr]
  if (!month) return null
  const day = parseInt(m[2], 10)
  if (!day || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Parse one entry line: "Artist: Album Title [Label]" → {artist, album, label} */
export function parsePitchforkEntry(
  line: string,
): { artist: string; album: string; label: string | null } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  // Need a colon separating artist from album
  const colonIdx = trimmed.indexOf(':')
  if (colonIdx === -1) return null
  const artist = trimmed.slice(0, colonIdx).trim()
  const rest = trimmed.slice(colonIdx + 1).trim()
  if (!artist || !rest) return null
  // Strip trailing label in brackets
  const labelMatch = rest.match(/^(.*?)\s*\[([^\]]+)\]\s*$/)
  let album: string
  let label: string | null = null
  if (labelMatch) {
    album = labelMatch[1].trim()
    label = labelMatch[2].trim()
  } else {
    album = rest
  }
  if (!album) return null
  // Skip prose lines: heuristic — entry shouldn't be a sentence ending in period
  // unless it's clearly an entry (album names with periods are common, so we
  // can't strictly enforce). But we DO skip if "album" is too long (>120 chars
  // suggests a paragraph not a title).
  if (album.length > 120) return null
  return { artist, album, label }
}

/** Top-level entry: fetch the page, parse the body, return CalendarRelease[]. */
export async function scrapePitchfork(year: number): Promise<{
  releases: CalendarRelease[]
  fetched: boolean
}> {
  const html = await fetchPitchforkHtml()
  if (html === null) return { releases: [], fetched: false }
  const body = extractArticleText(html)
  if (!body) return { releases: [], fetched: true }

  const releases = parsePitchforkBody(body, year)
  return { releases, fetched: true }
}

/** Pure parser — split body into lines, walk for date headers + entries. */
export function parsePitchforkBody(body: string, year: number): CalendarRelease[] {
  // Pitchfork's text comes out as a single space-collapsed string. We need to
  // split on date-header boundaries instead of newlines.
  // Build a regex that matches "Month D" anywhere and split on those positions.
  // Pitchfork's text body has no whitespace between date headers and the
  // first entry that follows ("May 5Alabaster DePlume..."). Match the date
  // tightly followed by an uppercase letter (start of artist name) so we
  // pick up the concatenated form. The lookahead also rejects the inline
  // "Friday, May 8, 2026" recap text since that's followed by a comma.
  const dateRe = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*(\d{1,2})(?=[A-Z])/g
  const matches: Array<{ index: number; date: string; raw: string }> = []
  let m: RegExpExecArray | null
  while ((m = dateRe.exec(body)) !== null) {
    const date = parsePitchforkDate(`${m[1]} ${m[2]}`, year)
    if (date) matches.push({ index: m.index, date, raw: m[0] })
  }
  if (matches.length === 0) return []

  const releases: CalendarRelease[] = []
  for (let i = 0; i < matches.length; i++) {
    // Start AFTER the matched date header (use the source text length, not
    // the formatted ISO date length).
    const start = matches[i].index + matches[i].raw.length
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length
    // Substring between date header and next date header
    const chunk = body.slice(start, end)
    // Each entry separated by lines like "Artist: Album [Label]". Pitchfork's
    // text body has no newlines after cheerio.text() collapses whitespace, so
    // we split on " [Label] " boundaries plus the next "Artist:" pattern.
    // Heuristic: split on `]` followed by an artist name + colon.
    // Simpler: regex-extract all "X: Y [Z]" patterns from the chunk.
    const entryRe = /([A-Z][^:[\]]{0,80}?):\s+([^[\]]{1,120}?)\s*\[([^\]]+)\]/g
    let em: RegExpExecArray | null
    while ((em = entryRe.exec(chunk)) !== null) {
      const artist = em[1].trim().replace(/^,\s+/, '')
      const album = em[2].trim()
      const label = em[3].trim()
      if (!artist || !album) continue
      // Skip header-like noise such as "New music releases for Friday, May 8":
      if (/new music releases?/i.test(artist) || /new music releases?/i.test(album)) continue
      releases.push({
        source: 'pitchfork',
        source_url: URL,
        artist_name_raw: artist,
        album_name: album,
        release_date: matches[i].date,
        release_type: 'album',
        raw_payload: { label, raw: em[0] },
      })
    }
  }

  // De-duplicate exact (artist, album, date) tuples within this scrape
  const seen = new Set<string>()
  return releases.filter(r => {
    const k = `${r.artist_name_raw}|${r.album_name}|${r.release_date}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
