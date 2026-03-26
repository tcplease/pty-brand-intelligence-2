import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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

// ── Artist metadata ───────────────────────────────────
async function getArtistMeta(cmId: number, token: string) {
  const res = await fetch(`https://api.chartmetric.com/api/artist/${cmId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
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
}

// ── Spotify artist ID (from /urls endpoint) ──────────
async function getSpotifyArtistId(cmId: number, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.chartmetric.com/api/artist/${cmId}/urls`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    const spotifyEntry = (data.obj || []).find((u: any) => u.domain === 'spotify')
    if (!spotifyEntry?.url?.[0]) return null
    // Parse ID from URL: https://open.spotify.com/artist/XXXXX
    const match = spotifyEntry.url[0].match(/\/artist\/([a-zA-Z0-9]+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// ── Career stage + score ─────────────────────────────
async function getCareerData(cmId: number, token: string): Promise<{ stage: string | null; score: number | null }> {
  const res = await fetch(
    `https://api.chartmetric.com/api/artist/${cmId}/career?limit=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return { stage: null, score: null }
  const data = await res.json()
  const entry = data?.obj?.[0]
  return {
    stage: entry?.stage || null,
    score: entry?.score != null ? parseFloat(entry.score) : null,
  }
}

// ── Social stats ──────────────────────────────────────
async function getSocialStats(cmId: number, token: string) {
  const stats: Record<string, number | null> = {
    spotify_followers: null,
    spotify_monthly_listeners: null,
    instagram_followers: null,
    youtube_subscribers: null,
    tiktok_followers: null,
  }

  const endpoints = [
    { key: 'spotify_followers', path: `stat/spotify`, extract: (d: any) => d?.obj?.followers?.[0]?.value },
    { key: 'spotify_monthly_listeners', path: `stat/spotify`, extract: (d: any) => d?.obj?.monthly_listeners?.[0]?.value },
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
      }
    } catch {}
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

// ── Instagram audience (the big one — has brand affinities) ──
async function getInstagramAudience(cmId: number, token: string) {
  const res = await fetch(
    `https://api.chartmetric.com/api/artist/${cmId}/instagram-audience-stats`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return null
  const data = await res.json()
  return data?.obj || null
}

// ── Helpers ───────────────────────────────────────────
function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function parseFloat2(val: any): number | null {
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

function getEthnicityPct(ethnicities: any[], code: string): number {
  return parseFloat(ethnicities?.find((e: any) => e.code === code)?.weight || '0')
}

function getAgePct(ageGender: any[], ageCode: string): number {
  const row = ageGender?.find((r: any) => r.code === ageCode)
  if (!row) return 0
  return parseFloat(row.male || '0') + parseFloat(row.female || '0')
}

// ── Main sync ─────────────────────────────────────────
export async function POST(request: Request) {
  try {
    // Optional: pass ?limit=10 to sync a smaller batch for testing
    // Pass ?ids=123,456 to sync specific artists
    // Pass ?force=true to re-sync artists that already have cm_last_refreshed_at
    // Pass ?nullsocials=true to only sync artists missing social data
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '999')
    const idsParam = url.searchParams.get('ids')
    const force = url.searchParams.get('force') === 'true'
    const nullSocials = url.searchParams.get('nullsocials') === 'true'

    let query = supabase.from('intel_artists').select('chartmetric_id, name')

    if (idsParam) {
      const ids = idsParam.split(',').map(Number).filter(n => !isNaN(n))
      query = query.in('chartmetric_id', ids)
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

    console.log(`Syncing ${artists.length} artists from Chartmetric...`)

    const token = await getCMToken()
    let synced = 0
    let failed = 0
    let noAudience = 0

    for (const artist of artists) {
      const cmId = artist.chartmetric_id
      try {
        // Fetch all data in parallel where possible
        const [meta, careerData, socialStats, audience, spotifyId] = await Promise.all([
          getArtistMeta(cmId, token),
          getCareerData(cmId, token),
          getSocialStats(cmId, token),
          getInstagramAudience(cmId, token),
          getSpotifyArtistId(cmId, token),
        ])

        // Build the artist update — only include non-null values
        // so we never overwrite existing good data with null
        const rawUpdate: Record<string, any> = {
          name: meta?.name || artist.name,
          image_url: meta?.image_url,
          primary_genre: meta?.primary_genre,
          cm_score: meta?.cm_score,
          general_manager: meta?.general_manager,
          spotify_artist_id: spotifyId,
          career_stage: careerData.stage,
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
          const maleGender = audience.audience_genders?.find((g: any) => g.code === 'male')
          const femaleGender = audience.audience_genders?.find((g: any) => g.code === 'female')
          const ethnicities = audience.audience_ethnicities || []
          const ageGender = audience.audience_genders_per_age || []
          const topCountries = (audience.top_countries || []).slice(0, 10).map((c: any) => ({
            country: c.name,
            code: c.code,
            pct: parseFloat(c.percent || '0'),
          }))

          // Override instagram followers with audience data if available
          if (audience.followers) {
            artistUpdate.instagram_followers = audience.followers
          }

          artistUpdate.audience_male_pct = parseFloat2(maleGender?.weight)
          artistUpdate.audience_female_pct = parseFloat2(femaleGender?.weight)
          artistUpdate.age_13_17_pct = getAgePct(ageGender, '13-17')
          artistUpdate.age_18_24_pct = getAgePct(ageGender, '18-24')
          artistUpdate.age_25_34_pct = getAgePct(ageGender, '25-34')
          artistUpdate.age_35_44_pct = getAgePct(ageGender, '35-44')
          artistUpdate.age_45_64_pct = getAgePct(ageGender, '45-64')
          artistUpdate.age_65_plus_pct = getAgePct(ageGender, '65+')
          artistUpdate.audience_ethnicity = ethnicities.reduce((acc: any, e: any) => {
            acc[e.code] = parseFloat(e.weight || '0')
            return acc
          }, {})
          artistUpdate.top_countries = topCountries

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

    return NextResponse.json({
      success: true,
      total: artists.length,
      synced,
      no_audience_data: noAudience,
      failed,
    })
  } catch (err: any) {
    console.error('CM sync failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}