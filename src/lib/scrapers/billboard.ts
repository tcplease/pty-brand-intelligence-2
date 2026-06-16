// ── Billboard 2026 album release calendar scraper ──────────────
// Source: https://www.billboard.com/lists/new-albums-2026-calendar-...
// Page embeds all 12 months as `pmcGalleryExports.gallery[]`. Each gallery
// item is a slide with HTML in `description` containing:
//   <h3>Mon. D:</h3>
//   <ul class="wp-block-list">
//     <li>Artist Name, <em>Album Title</em> (Label)</li>
//   </ul>

import * as cheerio from 'cheerio'

export interface CalendarRelease {
  source: 'billboard' | 'genius_album' | 'genius_single' | 'pitchfork' | 'consequence'
  source_url: string
  artist_name_raw: string
  album_name: string
  release_date: string | null  // YYYY-MM-DD; null when extraction fails
  release_type: 'album' | 'single' | 'ep' | 'unknown'
  raw_payload?: Record<string, unknown>
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

interface BillboardGallerySlide {
  ID: number
  position: number
  title: string             // "January", "February", ...
  slug: string
  description: string       // raw HTML chunk for the month
}

/** Fetch the Billboard calendar page and extract embedded gallery JSON. */
export async function fetchBillboardCalendar(year: number): Promise<{
  url: string
  slides: BillboardGallerySlide[]
}> {
  const url = `https://www.billboard.com/lists/new-albums-${year}-calendar-new-music-releases-this-year/january-${year}-new-albums/`
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(), 20000)
  let html: string
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: ctrl.signal })
    if (!res.ok) throw new Error(`Billboard fetch failed: ${res.status}`)
    html = await res.text()
  } finally {
    clearTimeout(timeoutId)
  }

  const slides = extractGallerySlides(html)
  return { url, slides }
}

/** Pull the pmcGalleryExports JSON literal out of the page's inline script. */
export function extractGallerySlides(html: string): BillboardGallerySlide[] {
  const marker = 'pmcGalleryExports = '
  const idx = html.indexOf(marker)
  if (idx === -1) return []
  // The literal is a single JSON object terminated by `;\n`. Walk braces to find end.
  const start = idx + marker.length
  let depth = 0
  let end = -1
  let inStr = false
  let escape = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (escape) { escape = false; continue }
      if (c === '\\') { escape = true; continue }
      if (c === '"') { inStr = false }
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) { end = i + 1; break }
    }
  }
  if (end === -1) return []
  let parsed: { gallery?: BillboardGallerySlide[] }
  try {
    parsed = JSON.parse(html.slice(start, end))
  } catch {
    return []
  }
  return parsed.gallery ?? []
}

/** Parse one slide's HTML into a list of releases, tagged with the slide's month. */
export function parseSlide(
  slide: BillboardGallerySlide,
  year: number,
  pageUrl: string,
): CalendarRelease[] {
  const monthNum = MONTH_MAP[slide.title.toLowerCase()]
  if (!monthNum) return []

  const $ = cheerio.load(slide.description)
  const releases: CalendarRelease[] = []

  // Each h3 is a date header; the next ul (sibling or nested in a div) holds
  // the entries for that date. Walk h3s, pair with the next sibling ul.
  $('h3').each((_, h3) => {
    const date = parseDateHeader($(h3).text(), monthNum, year)
    if (!date) return

    // Search subsequent siblings for the first <ul>, or a div containing a ul.
    let ul = null as ReturnType<typeof $> | null
    let cursor = $(h3).next()
    while (cursor.length) {
      if (cursor.is('ul')) { ul = cursor; break }
      const nested = cursor.find('ul').first()
      if (nested.length) { ul = nested; break }
      if (cursor.is('h3')) break  // hit next date header, stop
      cursor = cursor.next()
    }
    if (!ul) return

    ul.find('li').each((_, li) => {
      const liText = $(li).text().trim()
      const albumName = $(li).find('em').first().text().trim()
      const parsed = parseListItem(liText, albumName)
      if (!parsed) return
      releases.push({
        source: 'billboard',
        source_url: pageUrl,
        artist_name_raw: parsed.artist,
        album_name: parsed.album,
        release_date: date,
        release_type: 'album',
        raw_payload: { month: slide.title, label: parsed.label, raw: liText },
      })
    })
  })

  return releases
}

/** "Jan. 9:" or "March 6:" or "Jan. 9" → "2026-01-09" */
export function parseDateHeader(text: string, fallbackMonth: number, year: number): string | null {
  const cleaned = text.trim().replace(/[:\s]+$/, '')
  // Match "Mon. D" or "Month D" or just "D"
  const m = cleaned.match(/^([A-Za-z]+)\.?\s+(\d{1,2})$/) || cleaned.match(/^(\d{1,2})$/)
  if (!m) return null
  let month = fallbackMonth
  let day: number
  if (m.length === 3) {
    const monthStr = m[1].toLowerCase().replace(/\.$/, '')
    month = MONTH_MAP[monthStr] ?? fallbackMonth
    day = parseInt(m[2], 10)
  } else {
    day = parseInt(m[1], 10)
  }
  if (!month || !day || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "The Kid Laroi, _Before I Forget_ (Columbia Records)" → {artist, album, label} */
export function parseListItem(
  liText: string,
  emText: string,
): { artist: string; album: string; label: string | null } | null {
  if (!emText) return null
  // The artist is everything before the album name, stripping trailing comma.
  const albumIdx = liText.indexOf(emText)
  if (albumIdx === -1) return null
  let artist = liText.slice(0, albumIdx).trim()
  artist = artist.replace(/[,:\s]+$/, '').trim()
  if (!artist) return null

  // Label is whatever follows the album name in parens at the end.
  const afterAlbum = liText.slice(albumIdx + emText.length).trim()
  const labelMatch = afterAlbum.match(/^\(([^)]+)\)/)
  const label = labelMatch ? labelMatch[1].trim() : null

  return { artist, album: emText, label }
}

/** Top-level entry: fetch + parse all months for the given year. */
export async function scrapeBillboard(year: number): Promise<CalendarRelease[]> {
  const { url, slides } = await fetchBillboardCalendar(year)
  const all: CalendarRelease[] = []
  for (const slide of slides) {
    all.push(...parseSlide(slide, year, url))
  }
  return all
}
