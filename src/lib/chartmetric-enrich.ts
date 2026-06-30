import { createServiceClient } from '@/lib/supabase'
import { getSpotifyToken, getLatestAlbum } from '@/lib/spotify'
import {
  latestStatValue,
  extractDemographics,
  extractBrandAffinities,
  extractSectorAffinities,
  extractSocialUrls,
  getInstagramAudience,
  type SocialUrls,
} from '@/lib/chartmetric'

// ── Shared Chartmetric enrichment unit ────────────────────────────────────────
// ONE place that turns a Chartmetric artist id into a fully-enriched, INSERT-only
// intel_artists row (demographics + brand/sector affinities + image_url + social
// URLs). Used by resolveAndEnrichArtist (Monday + Radar ingestion) and the
// chartmetric search route. INSERT-ONLY: never UPDATE-to-null, never delete CM
// data — the protect_cm_data / block_delete triggers enforce this at the DB layer
// and we honor it here. image_url is fetched from CM, never defaulted to null over
// an existing value (a fresh insert legitimately stores whatever CM returns).

const CM_API = 'https://api.chartmetric.com/api'
const CM_REFRESH_TOKEN = process.env.CHARTMETRIC_TOKEN!

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function getCMToken(): Promise<string> {
  const res = await fetch(`${CM_API}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshtoken: CM_REFRESH_TOKEN }),
  })
  const data = await res.json()
  if (!data.token) throw new Error('Failed to get CM token')
  return data.token
}

// ── CM search → candidate list (for reuse-aware selection + tiebreak) ──────────
export interface CMCandidate {
  id: number
  name: string
  cm_score: number | null
  followers: number
}

// Returns up to `limit` artist candidates for a query. Empty array = true zero
// candidates (the only condition that should stamp the negative cache).
export async function cmSearchArtists(
  query: string,
  token: string,
  limit = 5,
): Promise<CMCandidate[]> {
  const res = await fetch(
    `${CM_API}/search?q=${encodeURIComponent(query)}&type=artists&limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`CM search failed: HTTP ${res.status}`)
  const data = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const artists: any[] = data?.obj?.artists || []
  return artists
    .filter((a) => a?.id != null && a?.name)
    .map((a) => ({
      id: a.id,
      name: a.name,
      cm_score: a.cm_score ?? a.score ?? null,
      followers: a.sp_followers ?? a.followers ?? a.sp_monthly_listeners ?? 0,
    }))
}

// ── Per-artist fetch helpers (self-contained so any caller can enrich) ─────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMeta(cmId: number, token: string) {
  const res = await fetch(`${CM_API}/artist/${cmId}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`artist/${cmId} HTTP ${res.status}`)
  const obj = (await res.json())?.obj
  if (!obj) return null
  return {
    name: obj.name || null,
    image_url: obj.image_url || null,
    primary_genre: obj.genres?.primary?.name || null,
    cm_score: obj.cm_artist_score ?? obj.cm_score ?? null,
    general_manager: obj.general_manager || null,
  }
}

async function getUrls(cmId: number, token: string): Promise<SocialUrls> {
  const empty: SocialUrls = { spotify_artist_id: null, instagram_url: null, youtube_url: null, tiktok_url: null }
  const res = await fetch(`${CM_API}/artist/${cmId}/urls`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return empty
  return extractSocialUrls((await res.json())?.obj || [])
}

async function getCareer(cmId: number, token: string): Promise<{ stage: string | null }> {
  const res = await fetch(`${CM_API}/artist/${cmId}/career?limit=1`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { stage: null }
  const entry = (await res.json())?.obj?.[0]
  return { stage: entry?.stage || null }
}

async function getSocialStats(cmId: number, token: string): Promise<Record<string, number | null>> {
  const stats: Record<string, number | null> = {
    spotify_followers: null,
    spotify_monthly_listeners: null,
    instagram_followers: null,
    youtube_subscribers: null,
    tiktok_followers: null,
  }
  const endpoints = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { key: 'spotify_followers', path: 'stat/spotify', extract: (d: any) => d?.obj?.followers?.[0]?.value },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { key: 'spotify_monthly_listeners', path: 'stat/spotify', extract: (d: any) => latestStatValue(d?.obj?.listeners) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { key: 'instagram_followers', path: 'stat/instagram', extract: (d: any) => d?.obj?.followers?.[0]?.value },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { key: 'youtube_subscribers', path: 'stat/youtube_channel', extract: (d: any) => d?.obj?.subscribers?.[0]?.value },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { key: 'tiktok_followers', path: 'stat/tiktok', extract: (d: any) => d?.obj?.followers?.[0]?.value },
  ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responses: Record<string, any> = {}
  for (const path of [...new Set(endpoints.map((e) => e.path))]) {
    const res = await fetch(`${CM_API}/artist/${cmId}/${path}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) responses[path] = await res.json()
    await sleep(200)
  }
  for (const ep of endpoints) {
    const data = responses[ep.path]
    if (data) stats[ep.key] = ep.extract(data) ?? null
  }
  return stats
}

export interface EnrichResult {
  inserted: boolean
  chartmetric_id: number
  error: string | null
}

// Full enrichment + INSERT for a NOT-YET-PERSISTED artist. Caller MUST have
// confirmed there is no existing intel_artists row for this cmId (reuse-before-pay
// + existence check live in resolveAndEnrichArtist). Returns an error string rather
// than throwing/swallowing so the caller can surface it (never report success when
// the row didn't persist).
export async function insertEnrichedArtist(
  client: ReturnType<typeof createServiceClient>,
  cmId: number,
  token: string,
  opts: { source: string; discovery_status: string; fallbackName: string },
): Promise<EnrichResult> {
  try {
    const [meta, career, socialStats, audience, urls] = await Promise.all([
      getMeta(cmId, token),
      getCareer(cmId, token),
      getSocialStats(cmId, token),
      getInstagramAudience(cmId, token),
      getUrls(cmId, token),
    ])

    // Last album (Spotify) for album-cycle tracking — non-critical.
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
      } catch { /* skip */ }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record: Record<string, any> = {
      chartmetric_id: cmId,
      name: meta?.name || opts.fallbackName,
      image_url: meta?.image_url ?? null, // fetched from CM, not hardcoded null
      cm_score: meta?.cm_score ?? null,
      primary_genre: meta?.primary_genre ?? null,
      general_manager: meta?.general_manager ?? null,
      career_stage: career.stage,
      spotify_artist_id: urls.spotify_artist_id,
      instagram_url: urls.instagram_url,
      youtube_url: urls.youtube_url,
      tiktok_url: urls.tiktok_url,
      last_album_release_date: lastAlbumReleaseDate,
      last_album_name: lastAlbumName,
      source: opts.source,
      discovery_status: opts.discovery_status,
      is_active: true,
      cm_last_refreshed_at: new Date().toISOString(),
      ...socialStats,
    }
    if (audience) {
      if (audience.followers) record.instagram_followers = audience.followers
      Object.assign(record, extractDemographics(audience))
    }

    // INSERT-only. A surfaced error (not a swallow) is the whole point.
    const { error: insertErr } = await client.from('intel_artists').insert(record)
    if (insertErr) return { inserted: false, chartmetric_id: cmId, error: insertErr.message }

    // Affinities (>= 1.0x) — INSERT for the new row (nothing to clear).
    if (audience) {
      const brands = extractBrandAffinities(audience, cmId)
      if (brands.length) await client.from('intel_brand_affinities').insert(brands)
      const sectors = extractSectorAffinities(audience, cmId)
      if (sectors.length) await client.from('intel_sector_affinities').insert(sectors)
    }

    return { inserted: true, chartmetric_id: cmId, error: null }
  } catch (err) {
    return { inserted: false, chartmetric_id: cmId, error: err instanceof Error ? err.message : 'enrichment threw' }
  }
}
