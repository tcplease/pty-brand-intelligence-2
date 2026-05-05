// ── Genius release calendar scrapers (albums + singles) ───────────
// Source: https://genius.com/Genius-<month>-<year>-album-release-calendar-annotated
//         https://genius.com/Genius-<month>-<year>-singles-release-calendar-annotated
//
// Genius hosts the calendars as "album" pages, with the actual entries
// rendered into a `data-lyrics-container` div on per-month sub-pages.
// Each month follows the pattern:
//
//   <b>M/D</b><br/>
//   Artist - <i>Album Title</i> - X/Y
//   <br/>
//   Artist 2 - <i>Album Title 2</i> - X/Y
//   ...
//   <b>M/D</b><br/>     ← next date
//   ...
//
// X/Y is "songs transcribed / total tracks", ignored.
//
// Bot detection on Genius requires browser-like User-Agent + Accept headers.

import * as cheerio from 'cheerio'
import type { CalendarRelease } from './billboard'

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const

type Kind = 'album' | 'single'

function urlFor(year: number, month: string, kind: Kind): string {
  // Genius slug pattern: "Genius-january-2026-album-release-calendar-annotated"
  // singles: "Genius-january-2026-singles-release-calendar-annotated"
  const tail = kind === 'album' ? 'album' : 'singles'
  return `https://genius.com/Genius-${month}-${year}-${tail}-release-calendar-annotated`
}

function fetchHtml(url: string, timeoutMs = 15000): Promise<string | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  return fetch(url, { headers: BROWSER_HEADERS, signal: ctrl.signal })
    .then(async res => {
      if (!res.ok) {
        console.warn(`[genius] ${res.status} fetching ${url}`)
        return null
      }
      return res.text()
    })
    .catch(err => {
      console.warn(`[genius] fetch failed for ${url}:`, err instanceof Error ? err.message : err)
      return null
    })
    .finally(() => clearTimeout(t))
}

/** Parse one Genius monthly page into CalendarRelease[]. */
export function parseGeniusMonth(
  html: string,
  monthIdx: number,                     // 1-12
  year: number,
  kind: Kind,
  pageUrl: string,
): CalendarRelease[] {
  const $ = cheerio.load(html)
  const releases: CalendarRelease[] = []
  const source = kind === 'album' ? 'genius_album' : 'genius_single'

  // Each Lyrics__Container holds a chunk of the page content. There can be
  // multiple containers on the page; iterate all and walk their children
  // sequentially so we maintain h3/<b> → entry adjacency.
  const containers = $('[data-lyrics-container="true"]').toArray()
  if (containers.length === 0) return releases

  let currentDate: string | null = null

  // Walk every Lyrics container in order; treat them as one logical stream.
  for (const c of containers) {
    const childNodes = $(c).contents().toArray()
    let pendingText = ''  // accumulate text between elements (catches plain "Artist - <i>Album</i>" lines)

    const flushEntry = (rawText: string, italicText: string | null) => {
      if (!italicText) return
      const parsed = parseEntry(rawText, italicText)
      if (!parsed || !currentDate) return
      releases.push({
        source,
        source_url: pageUrl,
        artist_name_raw: parsed.artist,
        album_name: parsed.album,
        release_date: currentDate,
        release_type: kind,
        raw_payload: { month: MONTHS[monthIdx - 1], counter: parsed.counter, raw: rawText },
      })
    }

    for (let i = 0; i < childNodes.length; i++) {
      const node = childNodes[i] as { type?: string; tagName?: string; name?: string }
      const tag = node.name

      if (tag === 'b') {
        // Date header — finalize any pending text first
        if (pendingText.trim()) {
          // Pending text without an <i> tag → plain entry (no annotation link)
          // We leave plain-only entries on the floor in v1; nearly all entries
          // are wrapped in <a><span> so the loss is negligible.
          pendingText = ''
        }
        const dateText = $(node as never).text().trim()
        currentDate = parseGeniusDate(dateText, monthIdx, year)
      } else if (tag === 'a') {
        // Anchor wraps span with "Artist - <i>Album</i> - X/Y"
        const $a = $(node as never)
        const span = $a.find('span').first()
        if (!span.length) continue
        const italicText = span.find('i').first().text().trim() || null
        const rawText = span.text().trim()
        flushEntry(rawText, italicText)
        pendingText = ''
      } else if (tag === 'br') {
        // Boundary; flush pending plain text if it has an <i>
        pendingText = ''
      } else if (!tag) {
        // Text node — accumulate
        const text = $(node as never).text()
        if (text) pendingText += text
      } else {
        // Other tags: capture text recursively
        const text = $(node as never).text()
        if (text) pendingText += ' ' + text
      }
    }
  }

  return releases
}

/** Parse "Artist - Album - X/Y" → {artist, album, counter}. */
export function parseEntry(
  rawText: string,
  italicText: string,
): { artist: string; album: string; counter: string | null } | null {
  if (!italicText) return null
  // Find the italic substring within the raw text. Artist precedes it,
  // counter follows it.
  const albumIdx = rawText.indexOf(italicText)
  if (albumIdx === -1) return null
  let artist = rawText.slice(0, albumIdx).trim()
  // Trim trailing " - " or "- " or "—"
  artist = artist.replace(/\s*[-—]\s*$/, '').trim()
  if (!artist) return null

  const after = rawText.slice(albumIdx + italicText.length).trim()
  // Counter format: "- 7/7" or "- 0/17"
  const counterMatch = after.match(/^[-—]\s*(\d+\/\d+)\s*$/)
  const counter = counterMatch ? counterMatch[1] : null

  return { artist, album: italicText, counter }
}

/** "1/1" → "2026-01-01"; "1/16" → "2026-01-16". monthIdx is the page month. */
export function parseGeniusDate(text: string, monthIdx: number, year: number): string | null {
  const cleaned = text.trim().replace(/[:\s]+$/, '')
  // Format: "M/D" or "MM/DD"
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!m) return null
  const month = parseInt(m[1], 10)
  const day = parseInt(m[2], 10)
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null
  // If the date doesn't match the page's month, ignore (defensive — Genius
  // sometimes has cross-month entries with different formats).
  if (month !== monthIdx) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

interface ScrapeOptions {
  year: number
  kind: Kind
  /** Optional throttle between monthly fetches in ms. Genius is bot-sensitive. */
  pageDelayMs?: number
  /** Limit which months to fetch (default: all 12). */
  months?: number[]
}

/** Top-level: fetch + parse all 12 monthly pages for one year. */
export async function scrapeGenius(opts: ScrapeOptions): Promise<{
  releases: CalendarRelease[]
  pagesFetched: number
  pagesFailed: number
}> {
  const months = opts.months ?? Array.from({ length: 12 }, (_, i) => i + 1)
  const delay = opts.pageDelayMs ?? 800
  const all: CalendarRelease[] = []
  let pagesFetched = 0
  let pagesFailed = 0

  for (const monthIdx of months) {
    const monthName = MONTHS[monthIdx - 1]
    const url = urlFor(opts.year, monthName, opts.kind)
    const html = await fetchHtml(url)
    if (html === null) {
      pagesFailed++
    } else {
      pagesFetched++
      try {
        const rels = parseGeniusMonth(html, monthIdx, opts.year, opts.kind, url)
        all.push(...rels)
      } catch (err) {
        console.warn(`[genius] parse failed for ${url}:`, err instanceof Error ? err.message : err)
        pagesFailed++
      }
    }
    // Throttle between requests so Genius doesn't 429
    if (delay > 0 && monthIdx !== months[months.length - 1]) {
      await new Promise(r => setTimeout(r, delay))
    }
  }

  return { releases: all, pagesFetched, pagesFailed }
}
