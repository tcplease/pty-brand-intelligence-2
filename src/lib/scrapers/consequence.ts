// ── Consequence upcoming-releases calendar scraper ──────────────
// Source: https://consequence.net/upcoming-releases/
// Page structure (WordPress body):
//   <h2>May 2026</h2>                                   ← month + year
//   <p><strong>May 12th:</strong></p>                   ← day sub-header
//   <p style="padding-left:40px">&mdash; <strong>Artist</strong>
//        &ndash; <em>Title</em></p>                     ← one release per <p>
//
// Internal use only — we extract the factual artist/title/date pairs to drive
// our own Radar signals; we do not republish Consequence's editorial content.
// NOTE: confirm Consequence's Terms of Service permit this automated read
// before enabling the cron in production (flagged to Tim).

import * as cheerio from 'cheerio'
import type { CalendarRelease } from './billboard'

const SOURCE_URL = 'https://consequence.net/upcoming-releases/'

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Classify release type from the title text. */
function releaseType(title: string): CalendarRelease['release_type'] {
  if (/\bEP\b/.test(title)) return 'ep'
  if (/\bsingle\b/i.test(title)) return 'single'
  return 'album'
}

/** Parse the upcoming-releases HTML into release rows. */
export function parseConsequenceHtml(html: string, fallbackYear: number): CalendarRelease[] {
  const $ = cheerio.load(html)
  const releases: CalendarRelease[] = []

  let curYear = fallbackYear
  let curMonth: number | null = null
  let curDay: number | null = null

  $('h2, p').each((_, el) => {
    const $el = $(el)
    const tag = (el as { tagName?: string }).tagName
    const text = $el.text().replace(/\s+/g, ' ').trim()
    if (!text) return

    // Month header: "May 2026"
    if (tag === 'h2') {
      const m = text.match(/^([A-Za-z]+)\s+(\d{4})$/)
      if (m && MONTHS[m[1].toLowerCase()]) {
        curMonth = MONTHS[m[1].toLowerCase()]
        curYear = parseInt(m[2], 10)
        curDay = null
      }
      return
    }

    // Day sub-header: "May 12th:" (no <em>, plain date text)
    const dm = text.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?:?$/)
    if (dm && MONTHS[dm[1].toLowerCase()]) {
      curMonth = MONTHS[dm[1].toLowerCase()]
      curDay = parseInt(dm[2], 10)
      return
    }

    // Release entry: indented <p> bullet with <strong>artist</strong> – <em>title</em>
    const isEntry = ($el.attr('style') || '').includes('padding-left') || text.startsWith('—') // em-dash bullet
    if (!isEntry) return
    const artistRaw = $el.find('strong').first().text().replace(/\s+/g, ' ').trim()
    const titleRaw = $el.find('em').first().text().replace(/\s+/g, ' ').trim()
    if (!artistRaw || !titleRaw) return

    // Some entries put the separating dash inside <strong> ("A Box of Stars –")
    const artist = artistRaw.replace(/[–—-]\s*$/, '').trim()
    if (!artist) return

    const release_date =
      curMonth && curDay ? `${curYear}-${pad(curMonth)}-${pad(curDay)}` : null

    releases.push({
      source: 'consequence',
      source_url: SOURCE_URL,
      artist_name_raw: artist,
      album_name: titleRaw,
      release_date,
      release_type: releaseType(titleRaw),
      raw_payload: { month: curMonth, day: curDay, year: curYear },
    })
  })

  return releases
}

/** Fetch + parse the Consequence upcoming-releases calendar. */
export async function scrapeConsequence(
  fallbackYear: number,
): Promise<{ releases: CalendarRelease[]; fetched: boolean }> {
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(SOURCE_URL, { headers: BROWSER_HEADERS, signal: ctrl.signal })
    if (!res.ok) {
      console.error(`[consequence] fetch failed: ${res.status}`)
      return { releases: [], fetched: false }
    }
    const html = await res.text()
    return { releases: parseConsequenceHtml(html, fallbackYear), fetched: true }
  } catch (err) {
    console.error('[consequence] scrape error:', err instanceof Error ? err.message : err)
    return { releases: [], fetched: false }
  } finally {
    clearTimeout(timeoutId)
  }
}
