import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getSpotifyToken, getLatestAlbum } from '@/lib/spotify'
import { latestStatValue, extractDemographics, getInstagramAudience, extractSocialUrls, type SocialUrls } from '@/lib/chartmetric'
import { insertEnrichedArtist } from '@/lib/chartmetric-enrich'

export const maxDuration = 300

// Server-side only — service_role for all data ops (replaces the anon singleton).
const supabase = createServiceClient()

const CM_REFRESH_TOKEN = process.env.CHARTMETRIC_TOKEN!

// ── Auth ──────────────────────────────────────────────
async function getCMToken(): Promise<string> {
  const res = await fetch('https://api.chartmetric.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshtoken: CM_REFRESH_TOKEN }),
  })
  const data = await res.json()
  if (!data.token) throw new Error('Failed to get CM token')
  return data.token
}

// ── Fail-loud tracking ────────────────────────────────
// A CM call that returns non-2xx or throws is a real failure (alarm). A 200
// with empty data is legitimate. We count failures per endpoint and surface
// the summary in the run output so a regression (like May 2026's silent null
// demographics) shows up as a failure spike instead of vanishing into nulls.
type RecordFailure = (endpoint: string, cmId: number, detail: string) => void

interface FailureTracker {
  counts: Record<string, number>
  record: RecordFailure
}

function makeFailureTracker(): FailureTracker {
  const counts: Record<string, number> = {}
  return {
    counts,
    record(endpoint, cmId, detail) {
      counts[endpoint] = (counts[endpoint] || 0) + 1
      console.error(`[CM FAIL] ${endpoint} cm=${cmId}: ${detail}`)
    },
  }
}

// ── Artist metadata ───────────────────────────────────
async function getArtistMeta(cmId: number, token: string, onFail?: RecordFailure) {
  try {
    const res = await fetch(`https://api.chartmetric.com/api/artist/${cmId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      onFail?.('artist/:id', cmId, `HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    const obj = data?.obj
    if (!obj) return null

    return {
      name: obj.name || null,
      image_url: obj.image_url || null,
      primary_genre: obj.genres?.primary?.name || null,
      cm_score: obj.cm_artist_score ?? obj.cm_score ?? null,
      general_manager: obj.general_manager || null,
    }
  } catch (err: any) {
    onFail?.('artist/:id', cmId, `threw: ${err?.message || 'unknown'}`)
    return null
  }
}

// ── Social URLs + Spotify artist ID (from /urls endpoint) ──────────
// One /urls call yields the Spotify id AND the Instagram/YouTube/TikTok profile
// URLs (all full + openable), so social links cost zero extra CM calls.
async function getArtistUrls(cmId: number, token: string, onFail?: RecordFailure): Promise<SocialUrls> {
  const empty: SocialUrls = { spotify_artist_id: null, instagram_url: null, youtube_url: null, tiktok_url: null }
  try {
    const res = await fetch(`https://api.chartmetric.com/api/artist/${cmId}/urls`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      onFail?.('urls', cmId, `HTTP ${res.status}`)
      return empty
    }
    const data = await res.json()
    return extractSocialUrls(data.obj || [])
  } catch (err: any) {
    onFail?.('urls', cmId, `threw: ${err?.message || 'unknown'}`)
    return empty
  }
}

// ── Career stage + score ─────────────────────────────
async function getCareerData(cmId: number, token: string, onFail?: RecordFailure): Promise<{ stage: string | null; score: number | null }> {
  try {
    const res = await fetch(
      `https://api.chartmetric.com/api/artist/${cmId}/career?limit=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      onFail?.('career', cmId, `HTTP ${res.status}`)
      return { stage: null, score: null }
    }
    const data = await res.json()
    const entry = data?.obj?.[0]
    return {
      stage: entry?.stage || null,
      score: entry?.score != null ? parseFloat(entry.score) : null,
    }
  } catch (err: any) {
    onFail?.('career', cmId, `threw: ${err?.message || 'unknown'}`)
    return { stage: null, score: null }
  }
}

// ── Social stats ──────────────────────────────────────
async function getSocialStats(cmId: number, token: string, onFail?: RecordFailure) {
  const stats: Record<string, number | null> = {
    spotify_followers: null,
    spotify_monthly_listeners: null,
    instagram_followers: null,
    youtube_subscribers: null,
    tiktok_followers: null,
  }

  const endpoints = [
    { key: 'spotify_followers', path: `stat/spotify`, extract: (d: any) => d?.obj?.followers?.[0]?.value },
    { key: 'spotify_monthly_listeners', path: `stat/spotify`, extract: (d: any) => latestStatValue(d?.obj?.listeners) },
    { key: 'instagram_followers', path: `stat/instagram`, extract: (d: any) => d?.obj?.followers?.[0]?.value },
    { key: 'youtube_subscribers', path: `stat/youtube_channel`, extract: (d: any) => d?.obj?.subscribers?.[0]?.value },
    { key: 'tiktok_followers', path: `stat/tiktok`, extract: (d: any) => d?.obj?.followers?.[0]?.value },
  ]

  // Deduplicate paths (spotify appears twice)
  const uniquePaths = [...new Set(endpoints.map(e => e.path))]
  const responses: Record<string, any> = {}

  for (const path of uniquePaths) {
    try {
      const res = await fetch(
        `https://api.chartmetric.com/api/artist/${cmId}/${path}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.ok) {
        responses[path] = await res.json()
      } else {
        onFail?.(path, cmId, `HTTP ${res.status}`)
      }
    } catch (err: any) {
      onFail?.(path, cmId, `threw: ${err?.message || 'unknown'}`)
    }
    await sleep(200)
  }

  for (const ep of endpoints) {
    const data = responses[ep.path]
    if (data) {
      stats[ep.key] = ep.extract(data) ?? null
    }
  }

  return stats
}

// Instagram audience (demographics + brand/sector affinities) comes from the
// shared helper in @/lib/chartmetric (getInstagramAudience), imported above.

// ── Helpers ───────────────────────────────────────────
function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Main sync ─────────────────────────────────────────
// GET handler — search DB first, fall back to CM with full enrichment + storage
// Also: ?probe=true&id=<n> makes exactly one /artist/:id call (1 credit)
//       so we can measure per-credit cost against the account balance.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const probeId = url.searchParams.get('probe') === 'true' ? url.searchParams.get('id') : null
    if (probeId) {
      const startedAt = new Date().toISOString()
      const token = await getCMToken()  // /api/token, not artist-billed
      const res = await fetch(`https://api.chartmetric.com/api/artist/${probeId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const status = res.status
      let name: string | null = null
      try {
        const body = await res.json()
        name = body?.obj?.name ?? null
      } catch { /* ignore */ }
      return NextResponse.json({
        probe: true,
        startedAt,
        finishedAt: new Date().toISOString(),
        cm_endpoint: `/artist/${probeId}`,
        cm_endpoint_credits_documented: 1,
        cm_status: status,
        artist_name: name,
        note: 'Note any change in your CM credit balance after this single call.',
      })
    }

    const searchQuery = url.searchParams.get('search')
    if (!searchQuery) {
      return NextResponse.json({ error: 'search param required' }, { status: 400 })
    }

    // Step 1: Check our DB first — zero CM calls if we already have the artist
    const { data: existing } = await supabase
      .from('intel_artists')
      .select('*')
      .ilike('name', searchQuery)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json(existing[0])
    }

    // Step 2: Not in DB — search CM
    const token = await getCMToken()

    const searchRes = await fetch(
      `https://api.chartmetric.com/api/search?q=${encodeURIComponent(searchQuery)}&type=artists&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!searchRes.ok) throw new Error('CM search failed')
    const searchData = await searchRes.json()
    const match = searchData?.obj?.artists?.[0]
    if (!match) {
      return NextResponse.json({ error: 'Artist not found on Chartmetric' }, { status: 404 })
    }

    const cmId = match.id

    // Double-check DB by CM ID (in case name didn't match exactly)
    const { data: existingById } = await supabase
      .from('intel_artists')
      .select('*')
      .eq('chartmetric_id', cmId)
      .limit(1)

    if (existingById && existingById.length > 0) {
      return NextResponse.json(existingById[0])
    }

    // Step 3-5: Full enrichment + INSERT via the shared unit (demographics, brand +
    // sector affinities, image_url, social URLs). Service-role write so the row
    // actually persists; the error is SURFACED (the old swallow returned a success
    // object while nothing was stored).
    const enrich = await insertEnrichedArtist(createServiceClient(), cmId, token, {
      source: 'manual',
      discovery_status: 'unlisted',
      fallbackName: match.name,
    })
    if (enrich.error) {
      return NextResponse.json({ error: `Failed to store artist: ${enrich.error}`, chartmetric_id: cmId }, { status: 502 })
    }

    // Return the persisted row.
    const { data: stored } = await supabase
      .from('intel_artists')
      .select('*')
      .eq('chartmetric_id', cmId)
      .limit(1)
    return NextResponse.json(stored?.[0] ?? { chartmetric_id: cmId, stored: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    // Optional: pass ?limit=10 to sync a smaller batch for testing
    // Pass ?ids=123,456 to sync specific artists
    // Pass ?force=true to re-sync artists that already have cm_last_refreshed_at
    // Pass ?nullsocials=true to only sync artists missing social data
    // Pass ?monthlyonly=true to surgically backfill ONLY spotify_monthly_listeners
    //   (one stat/spotify call each, fill-only, does NOT bump cm_last_refreshed_at)
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '999')
    const idsParam = url.searchParams.get('ids')
    const force = url.searchParams.get('force') === 'true'
    const nullSocials = url.searchParams.get('nullsocials') === 'true'
    const monthlyOnly = url.searchParams.get('monthlyonly') === 'true'
    const urlsOnly = url.searchParams.get('urlsonly') === 'true'

    let query = supabase.from('intel_artists').select('chartmetric_id, name')

    if (idsParam) {
      const ids = idsParam.split(',').map(Number).filter(n => !isNaN(n))
      query = query.in('chartmetric_id', ids)
    } else if (urlsOnly) {
      // Default cohort for the URL backfill: artists missing the Instagram URL
      query = query.is('instagram_url', null)
    } else if (monthlyOnly) {
      // Default cohort for the monthly-only sweep: has socials but null monthly listeners
      query = query.is('spotify_monthly_listeners', null).not('spotify_followers', 'is', null)
    } else if (nullSocials) {
      query = query.is('spotify_followers', null)
    } else if (!force) {
      query = query.is('cm_last_refreshed_at', null)
    }

    const { data: artists, error: fetchError } = await query.limit(limit)

    if (fetchError) throw new Error(fetchError.message)
    if (!artists?.length) {
      return NextResponse.json({ message: 'All artists already synced', count: 0 })
    }

    // ── Surgical social-URL-only backfill ──
    // One /urls call per artist; fills instagram_url/youtube_url/tiktok_url
    // (+ spotify_artist_id) ONLY where currently null (fill-don't-clobber).
    // Does NOT bump cm_last_refreshed_at (partial pull, Never-Do rule 16).
    if (urlsOnly) {
      const token = await getCMToken()
      const tracker = makeFailureTracker()
      let updated = 0
      let noUrls = 0
      for (const artist of artists) {
        const cmId = artist.chartmetric_id
        const social = await getArtistUrls(cmId, token, tracker.record)
        const patch: Record<string, string> = {}
        if (social.instagram_url) patch.instagram_url = social.instagram_url
        if (social.youtube_url) patch.youtube_url = social.youtube_url
        if (social.tiktok_url) patch.tiktok_url = social.tiktok_url
        if (social.spotify_artist_id) patch.spotify_artist_id = social.spotify_artist_id
        if (Object.keys(patch).length === 0) { noUrls++; await sleep(300); continue }
        patch.updated_at = new Date().toISOString()
        // Fill-only: the protect_cm_data trigger already blocks clobbering a
        // populated value, but we also avoid the write surfacing a no-op.
        const { error: updErr } = await supabase
          .from('intel_artists')
          .update(patch)
          .eq('chartmetric_id', cmId)
        if (updErr) {
          tracker.record('db-update', cmId, updErr.message)
        } else {
          updated++
        }
        await sleep(300)
      }
      const cmCallFailures = Object.values(tracker.counts).reduce((a, b) => a + b, 0)
      if (cmCallFailures > 0) console.error(`[CM URLS-ONLY] ${cmCallFailures} failures:`, tracker.counts)
      return NextResponse.json({
        success: true,
        mode: 'urlsonly',
        total: artists.length,
        updated,
        no_urls: noUrls,
        cm_call_failures: cmCallFailures,
        failures_by_endpoint: tracker.counts,
      })
    }

    // ── Surgical monthly-listeners-only sweep ──
    // Updates ONLY spotify_monthly_listeners (+ updated_at). Never touches
    // demographics/socials/affinities and never bumps cm_last_refreshed_at, so a
    // partial pull isn't misrepresented as a full refresh (Never-Do rule 16).
    // Fill-only: skips artists whose monthly listeners are already populated.
    if (monthlyOnly) {
      const token = await getCMToken()
      const tracker = makeFailureTracker()
      let updated = 0
      let stillNull = 0
      for (const artist of artists) {
        const cmId = artist.chartmetric_id
        try {
          const res = await fetch(`https://api.chartmetric.com/api/artist/${cmId}/stat/spotify`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) {
            tracker.record('stat/spotify', cmId, `HTTP ${res.status}`)
            stillNull++
            await sleep(300)
            continue
          }
          const data = await res.json()
          const monthly = latestStatValue(data?.obj?.listeners)
          if (monthly == null) {
            stillNull++
          } else {
            const { error: updErr } = await supabase
              .from('intel_artists')
              .update({ spotify_monthly_listeners: monthly, updated_at: new Date().toISOString() })
              .eq('chartmetric_id', cmId)
              .is('spotify_monthly_listeners', null) // fill-only: never clobber
            if (updErr) {
              tracker.record('db-update', cmId, updErr.message)
              stillNull++
            } else {
              updated++
            }
          }
        } catch (err: any) {
          tracker.record('stat/spotify', cmId, `threw: ${err?.message || 'unknown'}`)
          stillNull++
        }
        await sleep(300)
      }
      const cmCallFailures = Object.values(tracker.counts).reduce((a, b) => a + b, 0)
      if (cmCallFailures > 0) console.error(`[CM MONTHLY-ONLY] ${cmCallFailures} failures:`, tracker.counts)
      return NextResponse.json({
        success: true,
        mode: 'monthlyonly',
        total: artists.length,
        updated,
        still_null: stillNull,
        cm_call_failures: cmCallFailures,
        failures_by_endpoint: tracker.counts,
      })
    }

    console.log(`Syncing ${artists.length} artists from Chartmetric...`)

    const token = await getCMToken()
    const tracker = makeFailureTracker()
    let synced = 0
    let failed = 0
    let noAudience = 0

    for (const artist of artists) {
      const cmId = artist.chartmetric_id
      try {
        // Fetch all data in parallel where possible
        const [meta, careerData, socialStats, audience, urls] = await Promise.all([
          getArtistMeta(cmId, token, tracker.record),
          getCareerData(cmId, token, tracker.record),
          getSocialStats(cmId, token, tracker.record),
          getInstagramAudience(cmId, token, (detail) => tracker.record('instagram-audience-stats', cmId, detail)),
          getArtistUrls(cmId, token, tracker.record),
        ])

        // Fetch last album release from Spotify (for album cycle tracking)
        let lastAlbumReleaseDate: string | null = null
        let lastAlbumName: string | null = null
        if (urls.spotify_artist_id) {
          try {
            const spToken = await getSpotifyToken()
            const latest = await getLatestAlbum(spToken, urls.spotify_artist_id)
            if (latest) {
              lastAlbumReleaseDate = latest.release_date
              lastAlbumName = latest.name
            }
          } catch { /* skip — non-critical */ }
        }

        // Build the artist update — only include non-null values
        // so we never overwrite existing good data with null (fill-don't-clobber)
        const rawUpdate: Record<string, any> = {
          name: meta?.name || artist.name,
          image_url: meta?.image_url,
          primary_genre: meta?.primary_genre,
          cm_score: meta?.cm_score,
          general_manager: meta?.general_manager,
          spotify_artist_id: urls.spotify_artist_id,
          instagram_url: urls.instagram_url,
          youtube_url: urls.youtube_url,
          tiktok_url: urls.tiktok_url,
          career_stage: careerData.stage,
          last_album_release_date: lastAlbumReleaseDate,
          last_album_name: lastAlbumName,
          ...socialStats,
          cm_last_refreshed_at: new Date().toISOString(),
          is_active: true,
        }
        // Strip null/undefined values to avoid overwriting existing data
        const artistUpdate: Record<string, any> = {}
        for (const [key, val] of Object.entries(rawUpdate)) {
          if (val !== null && val !== undefined) artistUpdate[key] = val
        }

        // If we got audience data, add demographics
        if (audience) {
          // Override instagram followers with audience data if available
          if (audience.followers) {
            artistUpdate.instagram_followers = audience.followers
          }

          // Shared extractor: gender from audience_genders with a fallback to
          // summing audience_genders_per_age when that array is empty. Only
          // merge non-null fields so a blank sub-field never clobbers existing
          // good data (COALESCE-style fill).
          const demographics = extractDemographics(audience)
          for (const [key, val] of Object.entries(demographics)) {
            if (val !== null && val !== undefined) artistUpdate[key] = val
          }

          // ── Brand affinities (only >= 1.0x) ──
          const brandAffinities = (audience.audience_brand_affinities || [])
            .filter((b: any) => parseFloat(b.affinity) >= 1.0)
            .map((b: any) => ({
              chartmetric_id: cmId,
              brand_id: b.id || 0,
              brand_name: b.name,
              affinity_scale: parseFloat(b.affinity),
              follower_count: Math.round(
                (parseFloat(b.weight) / 100) * (audience.followers || 0)
              ),
              interest_category: b.category || null,
            }))

          if (brandAffinities.length) {
            // Clear old affinities for this artist
            await supabase
              .from('intel_brand_affinities')
              .delete()
              .eq('chartmetric_id', cmId)

            // Insert in batches of 100
            for (let i = 0; i < brandAffinities.length; i += 100) {
              await supabase
                .from('intel_brand_affinities')
                .insert(brandAffinities.slice(i, i + 100))
            }
          }

          // ── Sector affinities (only >= 1.0x) ──
          const sectorAffinities = (audience.audience_interests || [])
            .filter((s: any) => parseFloat(s.affinity) >= 1.0)
            .map((s: any, i: number) => ({
              chartmetric_id: cmId,
              sector_id: s.id || i,
              sector_name: s.name,
              affinity_scale: parseFloat(s.affinity),
            }))

          if (sectorAffinities.length) {
            await supabase
              .from('intel_sector_affinities')
              .delete()
              .eq('chartmetric_id', cmId)

            await supabase
              .from('intel_sector_affinities')
              .insert(sectorAffinities)
          }
        } else {
          noAudience++
        }

        // Update the artist row
        await supabase
          .from('intel_artists')
          .update(artistUpdate)
          .eq('chartmetric_id', cmId)

        synced++
        console.log(`✓ ${artist.name} (${synced}/${artists.length})`)

        // Rate limiting — ~3 calls per artist already made,
        // plus we want to stay under Chartmetric's limits
        await sleep(500)
      } catch (err: any) {
        console.error(`✗ ${artist.name}: ${err.message}`)
        failed++
        await sleep(300)
      }
    }

    // Per-endpoint failure summary — a spike here is the alarm that CM calls
    // are erroring rather than returning data. Empty-but-200 is NOT counted.
    const cmCallFailures = Object.values(tracker.counts).reduce((a, b) => a + b, 0)
    if (cmCallFailures > 0) {
      console.error(`[CM SYNC] ${cmCallFailures} CM call failures this run:`, tracker.counts)
    }

    return NextResponse.json({
      success: true,
      total: artists.length,
      synced,
      no_audience_data: noAudience,
      failed,
      cm_call_failures: cmCallFailures,
      failures_by_endpoint: tracker.counts,
    })
  } catch (err: any) {
    console.error('CM sync failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}