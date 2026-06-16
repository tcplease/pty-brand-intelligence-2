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
import { scrapeConsequence } from '@/lib/scrapers/consequence'
import { buildMatcherIndex, matchName, normalizeName, isNoiseRelease, careerStageAllowed, type MatcherIndex } from '@/lib/release-matcher'

type SourceKey = 'billboard' | 'genius_album' | 'genius_single' | 'pitchfork' | 'consequence'
const ALL_SOURCES: SourceKey[] = ['billboard', 'genius_album', 'genius_single', 'pitchfork', 'consequence']
// genius_single is excluded: Genius's singles calendars have only the welcome
// description annotated; the actual entry list is in the lyrics body, which
// the API does not expose. Manual `?sources=genius_single` requests still
// attempt it but yield 0 entries.
const DEFAULT_SOURCES: SourceKey[] = ['billboard', 'genius_album', 'pitchfork', 'consequence']

export const maxDuration = 300

// Window for which calendar releases get surfaced as Radar `album_presave`
// signals. Wider FUTURE than the Spotify cron (which sees only 90d) because
// tour planning runs 3-12 months ahead — a calendar's whole point is the
// long-lead-time visibility Spotify lacks. RECENT stays tight: tours for
// already-dropped albums are typically already announced, so albums older
// than ~30d are noise.
const FUTURE_DAYS = 365
const RECENT_DAYS = 30

// Cap on inline CM career calls per run for matched-but-unenriched artists.
const CAREER_BACKFILL_CAP = 25

async function getCMToken(): Promise<string> {
  const res = await fetch('https://api.chartmetric.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshtoken: process.env.CHARTMETRIC_TOKEN }),
  })
  const data = await res.json()
  if (!data.token) throw new Error('Failed to get CM token')
  return data.token
}

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
    } else if (source === 'consequence') {
      const r = await scrapeConsequence(year)
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
    // Auto-enrich rule (CLAUDE.md "be smart about CM costs"): only auto-import
    // unmatched calendar artists if their release_date falls in the surfacing
    // window. Caps at N per run so a flood of new entries can't blow the
    // CM budget. Disable with ?auto_enrich=false. Tweak with ?auto_enrich_limit=N.
    const autoEnrich = url.searchParams.get('auto_enrich') !== 'false'
    const autoEnrichLimit = Math.max(0, parseInt(url.searchParams.get('auto_enrich_limit') || '25'))

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

    if (sources.includes('consequence')) {
      try {
        const r = await scrapeConsequence(year)
        sourceCounts.consequence = { count: r.releases.length, error: r.fetched ? null : 'page fetch failed' }
        allReleases = allReleases.concat(r.releases)
        console.log(`[release-calendar] consequence scraped: ${r.releases.length} entries (fetched=${r.fetched})`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        sourceCounts.consequence = { count: 0, error: msg }
        console.error('[release-calendar] consequence scrape failed:', msg)
      }
    }

    // ── Noise / reissue filter (applies to every scraper) ──
    // Drop reissues, deluxe/anniversary editions, box sets, soundtracks, live
    // albums, compilations, Various Artists, etc. before matching/surfacing.
    const preNoise = allReleases.length
    allReleases = allReleases.filter(r => !isNoiseRelease(r.artist_name_raw, r.album_name))
    const noiseDropped = preNoise - allReleases.length
    console.log(`[release-calendar] noise filter: dropped ${noiseDropped} of ${preNoise} releases`)

    // First match pass against existing roster
    let matched: Array<CalendarRelease & { chartmetric_id: number; matched_via: 'alias' | 'exact' }> = []
    let unmatched: CalendarRelease[] = []
    const matchPass = (releases: CalendarRelease[]) => {
      const m: typeof matched = []
      const u: CalendarRelease[] = []
      for (const r of releases) {
        const hit = matchName(r.artist_name_raw, index)
        if (hit.chartmetric_id != null && hit.via != null) {
          m.push({ ...r, chartmetric_id: hit.chartmetric_id, matched_via: hit.via })
        } else {
          u.push(r)
        }
      }
      return { m, u }
    }
    {
      const r = matchPass(allReleases)
      matched = r.m
      unmatched = r.u
    }
    console.log(`[release-calendar] first pass: matched=${matched.length}, unmatched=${unmatched.length}`)

    // ── Auto-enrich rule ─────────────────────────────────────────
    // Only enrich unmatched artists whose release falls in the surfacing
    // window (today − RECENT_DAYS to today + FUTURE_DAYS). Cap to keep CM
    // costs predictable. Cross-source mentions get priority.
    let autoEnriched = 0
    let autoEnrichSkipped = 0
    let autoEnrichFailed = 0
    if (!opts.dryRun && autoEnrich && autoEnrichLimit > 0 && unmatched.length > 0) {
      const today = new Date()
      const futureLimit = new Date(today); futureLimit.setDate(futureLimit.getDate() + FUTURE_DAYS)
      const recentLimit = new Date(today); recentLimit.setDate(recentLimit.getDate() - RECENT_DAYS)

      // Group by normalized name → track distinct sources for priority
      const byName = new Map<string, { displayName: string; sources: Set<string>; nearestDate: number }>()
      for (const u of unmatched) {
        if (!u.release_date) continue
        const rd = new Date(u.release_date).getTime()
        if (rd < recentLimit.getTime() || rd > futureLimit.getTime()) continue
        const norm = normalizeName(u.artist_name_raw)
        if (!norm) continue
        const existing = byName.get(norm)
        if (existing) {
          existing.sources.add(u.source)
          if (rd < existing.nearestDate) existing.nearestDate = rd
        } else {
          byName.set(norm, { displayName: u.artist_name_raw, sources: new Set([u.source]), nearestDate: rd })
        }
      }

      // Sort: cross-source first, then earliest upcoming release
      const candidates = [...byName.values()].sort((a, b) => {
        if (b.sources.size !== a.sources.size) return b.sources.size - a.sources.size
        return a.nearestDate - b.nearestDate
      }).slice(0, autoEnrichLimit)

      autoEnrichSkipped = byName.size - candidates.length
      console.log(`[release-calendar] auto-enrich: ${candidates.length} of ${byName.size} in-window candidates (cap=${autoEnrichLimit})`)

      // Resolve our own origin (Vercel sets VERCEL_URL, fall back to request)
      const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(request.url).origin
      for (const c of candidates) {
        try {
          const res = await fetch(`${origin}/api/sync/chartmetric?search=${encodeURIComponent(c.displayName)}`, {
            // 30s timeout — chartmetric search-and-enrich does ~9 CM calls
            signal: AbortSignal.timeout(30000),
          })
          if (!res.ok) {
            autoEnrichFailed++
            continue
          }
          const data = await res.json() as { chartmetric_id?: number; name?: string; error?: string }
          if (!data.chartmetric_id) {
            autoEnrichFailed++
            continue
          }
          // The GET handler creates new artists with discovery_status='unlisted'.
          // Flip in-window calendar-imports to 'new' so they show on Radar.
          await supabase
            .from('intel_artists')
            .update({ discovery_status: 'new' })
            .eq('chartmetric_id', data.chartmetric_id)
            .eq('discovery_status', 'unlisted')
          // Add to in-memory matcher index so the re-match below picks them up
          const norm = normalizeName(data.name || c.displayName)
          if (norm && !index.byName.has(norm)) {
            index.byName.set(norm, data.chartmetric_id)
          }
          autoEnriched++
          await new Promise(r => setTimeout(r, 400)) // rate-limit pacing
        } catch (err) {
          autoEnrichFailed++
          console.warn('[release-calendar] auto-enrich failed for', c.displayName, err instanceof Error ? err.message : err)
        }
      }
      console.log(`[release-calendar] auto-enrich done: ok=${autoEnriched} failed=${autoEnrichFailed} skipped=${autoEnrichSkipped}`)

      // Re-match unmatched against expanded index
      if (autoEnriched > 0) {
        const r = matchPass(unmatched)
        matched = matched.concat(r.m)
        unmatched = r.u
        console.log(`[release-calendar] after auto-enrich re-match: matched=${matched.length}, unmatched=${unmatched.length}`)
      }
    }

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

    // ── Career-stage gate (mid-level+) ──
    // Read career_stage for the in-window matched artists. career_stage in
    // intel_artists is the negative cache: developing/undiscovered artists are
    // read from the DB and dropped without a CM call. Only matched-but-
    // unenriched (null career_stage) artists get one CM career call each
    // (capped), filled back into intel_artists (fill-only). Still-null → dropped.
    const careerById = new Map<number, string | null>()
    {
      const ids = [...new Set(inWindow.map(r => r.chartmetric_id))]
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase
          .from('intel_artists')
          .select('chartmetric_id, career_stage')
          .in('chartmetric_id', ids.slice(i, i + 200))
        for (const a of data ?? []) careerById.set(a.chartmetric_id, a.career_stage)
      }
      const nullIds = ids.filter(id => !careerById.get(id))
      if (nullIds.length > 0) {
        try {
          const token = await getCMToken()
          for (const id of nullIds.slice(0, CAREER_BACKFILL_CAP)) {
            try {
              const res = await fetch(`https://api.chartmetric.com/api/artist/${id}/career?limit=1`, {
                headers: { Authorization: `Bearer ${token}` },
              })
              if (!res.ok) continue
              const stage = (await res.json())?.obj?.[0]?.stage ?? null
              if (stage) {
                careerById.set(id, stage)
                // fill-don't-clobber: only write when currently null
                await supabase.from('intel_artists').update({ career_stage: stage }).eq('chartmetric_id', id).is('career_stage', null)
              }
            } catch { /* skip — gate drops it as null */ }
            await new Promise(res => setTimeout(res, 300))
          }
        } catch (err) {
          console.error('[release-calendar] career backfill token failed:', err instanceof Error ? err.message : err)
        }
      }
    }

    // Pre-fetch existing activity_log keys to dedupe (chartmetric_id, album_name, release_date)
    const existingKeys = await loadExistingPresaveKeys(supabase, inWindow.map(r => r.chartmetric_id))

    let presavesInserted = 0
    let presaveErrors = 0
    let resurfaced = 0
    let careerGateSkipped = 0
    for (const r of inWindow) {
      if (!r.release_date) continue
      // Career-stage gate: surface only mid-level+ artists
      if (!careerStageAllowed(careerById.get(r.chartmetric_id))) { careerGateSkipped++; continue }
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
        const did = await resurfaceIfHidden(supabase, r.chartmetric_id, 'release_calendar', r.release_date)
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
      auto_enriched: autoEnriched,
      auto_enrich_failed: autoEnrichFailed,
      auto_enrich_skipped_over_cap: autoEnrichSkipped,
      calendar_rows_inserted: calendarInserted,
      calendar_errors: calendarErrors,
      first_upsert_error: firstUpsertError,
      in_window: inWindow.length,
      noise_dropped: noiseDropped,
      career_gate_skipped: careerGateSkipped,
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
