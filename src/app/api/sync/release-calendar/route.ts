// ── Crowd-sourced release calendar sync ─────────────────────────
// Scrapes album/single release calendars and surfaces matched artists'
// upcoming releases as `album_presave` activity_log signals so they
// appear on the Radar page.
//
// Sources: Billboard (annual album calendar), Genius (monthly album +
// singles calendars). Pitchfork lands in a follow-up PR.
//
// Routes:
//   GET  /api/sync/release-calendar              — cron entry (CRON_SECRET auth)
//   POST /api/sync/release-calendar              — manual trigger, no auth
//   GET|POST /api/sync/release-calendar?debug=<source>&year=2026
//                                                 — dry run, returns parsed
//                                                   releases + match results
//                                                   without DB writes.
//                                                   <source>: billboard |
//                                                   genius_album | genius_single
//   GET|POST /api/sync/release-calendar?dry=true  — full pipeline minus
//                                                   DB writes, returns counts
//   GET|POST /api/sync/release-calendar?sources=billboard,genius_album
//                                                 — restrict which sources to
//                                                   scrape (default: all)

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { resurfaceIfHidden } from '@/lib/signals'
import { scrapeBillboard, type CalendarRelease } from '@/lib/scrapers/billboard'
import { scrapeGenius } from '@/lib/scrapers/genius'
import { scrapePitchfork } from '@/lib/scrapers/pitchfork'
import { buildMatcherIndex, matchName, type MatcherIndex } from '@/lib/release-matcher'

type SourceKey = 'billboard' | 'genius_album' | 'genius_single' | 'pitchfork'
// Default cron sources. Genius is currently blocked from Vercel IPs (Cloudflare
// 403s the datacenter range) — it stays in ALL_SOURCES so manual `?sources=`
// requests work, but it's excluded from the default cron run below.
const ALL_SOURCES: SourceKey[] = ['billboard', 'genius_album', 'genius_single', 'pitchfork']
const DEFAULT_SOURCES: SourceKey[] = ['billboard', 'pitchfork']

export const maxDuration = 300

// Window for which calendar releases get surfaced as Radar `album_presave`
// signals. Wider FUTURE than the Spotify cron (which sees only 90d) because
// tour planning runs 3-12 months ahead — a calendar's whole point is the
// long-lead-time visibility Spotify lacks. RECENT stays tight: tours for
// already-dropped albums are typically already announced, so albums older
// than ~30d are noise.
const FUTURE_DAYS = 365
const RECENT_DAYS = 30

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('probe')) return runGeniusApiProbe(url)
  if (url.searchParams.get('debug')) return runDebug(request)
  if (url.searchParams.get('dry') === 'true') return runSync(request, { dryRun: true })

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runSync(request, { dryRun: false })
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('probe')) return runGeniusApiProbe(url)
  if (url.searchParams.get('debug')) return runDebug(request)
  return runSync(request, { dryRun: url.searchParams.get('dry') === 'true' })
}

// ── Probe Genius API to map out which endpoint exposes calendar data ──
// Usage:
//   ?probe=search&q=2026+album+release+calendar
//   ?probe=song&id=<song_id>&fmt=plain (or html, dom)
//   ?probe=referents&id=<song_id>
//   ?probe=album&id=<album_id>
//   ?probe=album_tracks&id=<album_id>
async function runGeniusApiProbe(url: URL): Promise<NextResponse> {
  const token = process.env.GENIUS_ACCESS_TOKEN
  if (!token) return NextResponse.json({ error: 'Missing GENIUS_ACCESS_TOKEN env' }, { status: 500 })

  const probe = url.searchParams.get('probe') || ''
  const id = url.searchParams.get('id')
  const q = url.searchParams.get('q')
  const fmt = url.searchParams.get('fmt') || 'plain'

  let target: string
  if (probe === 'search') {
    if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 })
    target = `https://api.genius.com/search?q=${encodeURIComponent(q)}`
  } else if (probe === 'song') {
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    target = `https://api.genius.com/songs/${id}?text_format=${fmt}`
  } else if (probe === 'referents') {
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    target = `https://api.genius.com/referents?song_id=${id}&text_format=${fmt}&per_page=50`
  } else if (probe === 'album') {
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    target = `https://api.genius.com/albums/${id}?text_format=${fmt}`
  } else if (probe === 'album_tracks') {
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    target = `https://api.genius.com/albums/${id}/tracks?per_page=50&text_format=${fmt}`
  } else {
    return NextResponse.json({ error: `Unknown probe: ${probe}` }, { status: 400 })
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(target, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    })
    const status = res.status
    let body: unknown = null
    try { body = await res.json() } catch { try { body = await res.text() } catch { body = '<unreadable>' } }
    return NextResponse.json({ probe, target, status, body })
  } catch (err: unknown) {
    return NextResponse.json({ probe, target, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    clearTimeout(t)
  }
}

// ── Debug: scrape one source, optionally match, no DB writes ───
async function runDebug(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url)
    const source = (url.searchParams.get('debug') || 'billboard') as SourceKey
    const year = parseInt(url.searchParams.get('year') || `${new Date().getFullYear()}`, 10)
    const matchEnabled = url.searchParams.get('match') !== 'false'
    const monthsParam = url.searchParams.get('months')
    const months = monthsParam ? monthsParam.split(',').map(s => parseInt(s, 10)).filter(n => n >= 1 && n <= 12) : undefined

    let releases: CalendarRelease[] = []
    if (source === 'billboard') {
      releases = await scrapeBillboard(year)
    } else if (source === 'genius_album') {
      const r = await scrapeGenius({ year, kind: 'album', months })
      releases = r.releases
    } else if (source === 'genius_single') {
      const r = await scrapeGenius({ year, kind: 'single', months })
      releases = r.releases
    } else if (source === 'pitchfork') {
      const r = await scrapePitchfork(year)
      releases = r.releases
    } else {
      return NextResponse.json({ error: `Unknown debug source: ${source}` }, { status: 400 })
    }

    let withMatches: Array<CalendarRelease & { match?: { chartmetric_id: number | null; via: string | null } }> = releases
    if (matchEnabled) {
      const supabase = createServiceClient()
      const index = await buildMatcherIndex(supabase)
      withMatches = releases.map(r => ({
        ...r,
        match: matchName(r.artist_name_raw, index),
      }))
    }

    const matched = withMatches.filter(r => r.match?.chartmetric_id != null).length

    return NextResponse.json({
      source,
      year,
      total: releases.length,
      matched,
      unmatched: releases.length - matched,
      sample: withMatches.slice(0, 20),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── Full sync: scrape, match, write to DB, surface to activity_log ─
interface SyncOptions { dryRun: boolean }

async function runSync(request: Request, opts: SyncOptions): Promise<NextResponse> {
  try {
    const url = new URL(request.url)
    const year = parseInt(url.searchParams.get('year') || `${new Date().getFullYear()}`, 10)
    const sourcesParam = url.searchParams.get('sources')
    const sources: SourceKey[] = sourcesParam
      ? sourcesParam.split(',').map(s => s.trim() as SourceKey).filter(s => ALL_SOURCES.includes(s))
      : DEFAULT_SOURCES

    console.log(`[release-calendar] starting${opts.dryRun ? ' (dry run)' : ''} for year=${year}, sources=${sources.join(',')}`)

    const supabase = createServiceClient()
    const index = await buildMatcherIndex(supabase)
    console.log(`[release-calendar] index built: ${index.byName.size} names, ${index.byAlias.size} aliases`)

    const sourceCounts: Record<string, { count: number; error: string | null }> = {}
    let allReleases: CalendarRelease[] = []

    if (sources.includes('billboard')) {
      try {
        const billboard = await scrapeBillboard(year)
        sourceCounts.billboard = { count: billboard.length, error: null }
        allReleases = allReleases.concat(billboard)
        console.log(`[release-calendar] billboard scraped: ${billboard.length} entries`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        sourceCounts.billboard = { count: 0, error: msg }
        console.error('[release-calendar] billboard scrape failed:', msg)
      }
    }

    if (sources.includes('genius_album')) {
      try {
        const r = await scrapeGenius({ year, kind: 'album' })
        sourceCounts.genius_album = { count: r.releases.length, error: r.pagesFailed > 0 ? `${r.pagesFailed} of 12 monthly pages failed` : null }
        allReleases = allReleases.concat(r.releases)
        console.log(`[release-calendar] genius_album scraped: ${r.releases.length} entries (${r.pagesFetched}/${r.pagesFetched + r.pagesFailed} pages)`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        sourceCounts.genius_album = { count: 0, error: msg }
        console.error('[release-calendar] genius_album scrape failed:', msg)
      }
    }

    if (sources.includes('genius_single')) {
      try {
        const r = await scrapeGenius({ year, kind: 'single' })
        sourceCounts.genius_single = { count: r.releases.length, error: r.pagesFailed > 0 ? `${r.pagesFailed} of 12 monthly pages failed` : null }
        allReleases = allReleases.concat(r.releases)
        console.log(`[release-calendar] genius_single scraped: ${r.releases.length} entries (${r.pagesFetched}/${r.pagesFetched + r.pagesFailed} pages)`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        sourceCounts.genius_single = { count: 0, error: msg }
        console.error('[release-calendar] genius_single scrape failed:', msg)
      }
    }

    if (sources.includes('pitchfork')) {
      try {
        const r = await scrapePitchfork(year)
        sourceCounts.pitchfork = { count: r.releases.length, error: r.fetched ? null : 'page fetch failed' }
        allReleases = allReleases.concat(r.releases)
        console.log(`[release-calendar] pitchfork scraped: ${r.releases.length} entries (fetched=${r.fetched})`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        sourceCounts.pitchfork = { count: 0, error: msg }
        console.error('[release-calendar] pitchfork scrape failed:', msg)
      }
    }

    // Match names
    const matched: Array<CalendarRelease & { chartmetric_id: number; matched_via: 'alias' | 'exact' }> = []
    const unmatched: CalendarRelease[] = []
    for (const r of allReleases) {
      const m = matchName(r.artist_name_raw, index)
      if (m.chartmetric_id != null && m.via != null) {
        matched.push({ ...r, chartmetric_id: m.chartmetric_id, matched_via: m.via })
      } else {
        unmatched.push(r)
      }
    }
    console.log(`[release-calendar] matched=${matched.length}, unmatched=${unmatched.length}`)

    // Dry run: stop here
    if (opts.dryRun) {
      return NextResponse.json({
        success: true,
        dry_run: true,
        year,
        sources: sourceCounts,
        total_scraped: allReleases.length,
        matched: matched.length,
        unmatched: unmatched.length,
        sample_matched: matched.slice(0, 10).map(m => ({
          artist: m.artist_name_raw,
          album: m.album_name,
          date: m.release_date,
          cm_id: m.chartmetric_id,
          via: m.matched_via,
        })),
        sample_unmatched: unmatched.slice(0, 10).map(u => ({
          artist: u.artist_name_raw,
          album: u.album_name,
          date: u.release_date,
        })),
      })
    }

    // ── Write release_calendar rows ─────────────────────────
    // UPSERT: dedup on (source, source_url, artist_name_raw, album_name)
    const calendarRows = [
      ...matched.map(r => ({
        source: r.source,
        source_url: r.source_url,
        artist_name_raw: r.artist_name_raw,
        album_name: r.album_name,
        release_date: r.release_date,
        release_type: r.release_type,
        chartmetric_id: r.chartmetric_id,
        matched_via: r.matched_via,
        matched_at: new Date().toISOString(),
        raw_payload: r.raw_payload ?? null,
      })),
      ...unmatched.map(r => ({
        source: r.source,
        source_url: r.source_url,
        artist_name_raw: r.artist_name_raw,
        album_name: r.album_name,
        release_date: r.release_date,
        release_type: r.release_type,
        chartmetric_id: null,
        matched_via: null,
        matched_at: null,
        raw_payload: r.raw_payload ?? null,
      })),
    ]

    let calendarInserted = 0
    let calendarErrors = 0
    let firstUpsertError: { message: string; details: string | null; hint: string | null; code: string | null } | null = null
    if (calendarRows.length > 0) {
      // Insert in chunks of 500 to keep request size reasonable
      for (let i = 0; i < calendarRows.length; i += 500) {
        const chunk = calendarRows.slice(i, i + 500)
        const { error } = await supabase
          .from('release_calendar')
          .upsert(chunk, {
            onConflict: 'source,source_url,artist_name_raw,album_name',
            ignoreDuplicates: true,
          })
        if (error) {
          console.error(
            '[release-calendar] upsert error:',
            JSON.stringify({
              message: error.message,
              details: error.details,
              hint: error.hint,
              code: error.code,
            }),
          )
          if (!firstUpsertError) {
            firstUpsertError = {
              message: error.message,
              details: error.details ?? null,
              hint: error.hint ?? null,
              code: error.code ?? null,
            }
          }
          calendarErrors += chunk.length
        } else {
          calendarInserted += chunk.length
        }
      }
    }

    // ── Surface matched releases to activity_log ─────────────
    // Window: today - RECENT_DAYS to today + FUTURE_DAYS. Skips far-future or
    // ancient releases so the Radar feed isn't flooded.
    const today = new Date()
    const futureLimit = new Date(today); futureLimit.setDate(futureLimit.getDate() + FUTURE_DAYS)
    const recentLimit = new Date(today); recentLimit.setDate(recentLimit.getDate() - RECENT_DAYS)

    const inWindow = matched.filter(r => {
      if (!r.release_date) return false
      const rd = new Date(r.release_date)
      return rd >= recentLimit && rd <= futureLimit
    })

    // Pre-fetch existing activity_log keys to dedupe (chartmetric_id, album_name, release_date)
    const existingKeys = await loadExistingPresaveKeys(supabase, inWindow.map(r => r.chartmetric_id))

    let presavesInserted = 0
    let presaveErrors = 0
    let resurfaced = 0
    for (const r of inWindow) {
      if (!r.release_date) continue
      const dedupeKey = `${r.chartmetric_id}|${normalizeAlbumKey(r.album_name)}|${r.release_date}`
      if (existingKeys.has(dedupeKey)) continue

      const isUpcoming = new Date(r.release_date) > today
      const typeLabel = r.release_type === 'single' ? 'Single' : r.release_type === 'ep' ? 'EP' : 'Album'
      const prefix = isUpcoming ? 'Upcoming' : 'New Release'

      const { error } = await supabase.from('activity_log').insert({
        chartmetric_id: r.chartmetric_id,
        event_type: 'album_presave',
        event_title: `${prefix}: "${r.album_name}" (${typeLabel})`,
        event_detail: {
          album_name: r.album_name,
          release_date: r.release_date,
          release_type: r.release_type,
          source: r.source,
          source_url: r.source_url,
          matched_via: r.matched_via,
        },
        event_date: r.release_date,
      })
      if (error) {
        console.error(`[release-calendar] activity_log insert failed for cm=${r.chartmetric_id}:`, error.message)
        presaveErrors++
        continue
      }
      presavesInserted++
      existingKeys.add(dedupeKey)

      try {
        const did = await resurfaceIfHidden(supabase, r.chartmetric_id, 'release_calendar')
        if (did) resurfaced++
      } catch (err) {
        console.error(`[release-calendar] resurface failed for cm=${r.chartmetric_id}:`, err)
      }
    }

    console.log(
      `[release-calendar] done: calendar_rows=${calendarInserted}/${calendarRows.length}, ` +
      `presaves_inserted=${presavesInserted}, resurfaced=${resurfaced}, errors=${calendarErrors + presaveErrors}`,
    )

    return NextResponse.json({
      success: true,
      year,
      sources: sourceCounts,
      total_scraped: allReleases.length,
      matched: matched.length,
      unmatched: unmatched.length,
      calendar_rows_inserted: calendarInserted,
      calendar_errors: calendarErrors,
      first_upsert_error: firstUpsertError,
      in_window: inWindow.length,
      presaves_inserted: presavesInserted,
      presave_errors: presaveErrors,
      resurfaced,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[release-calendar] fatal:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Normalize album name for dedup (case + punctuation insensitive). */
function normalizeAlbumKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Load existing presave keys for the given chartmetric_ids. */
async function loadExistingPresaveKeys(
  supabase: ReturnType<typeof createServiceClient>,
  cmIds: number[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (cmIds.length === 0) return out
  const unique = Array.from(new Set(cmIds))
  // Chunk the .in() filter to avoid Postgrest URL length limits
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100)
    const { data, error } = await supabase
      .from('activity_log')
      .select('chartmetric_id, event_date, event_detail')
      .eq('event_type', 'album_presave')
      .in('chartmetric_id', batch)
    if (error || !data) continue
    for (const row of data) {
      const detail = row.event_detail as Record<string, unknown> | null
      const albumName = (detail?.album_name as string) ?? (detail?.album_id as string) ?? ''
      out.add(`${row.chartmetric_id}|${normalizeAlbumKey(albumName)}|${row.event_date}`)
    }
  }
  return out
}
