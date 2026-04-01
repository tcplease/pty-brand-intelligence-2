import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { resurfaceIfHidden } from '@/lib/signals'

const CM_REFRESH_TOKEN = process.env.CHARTMETRIC_TOKEN!
const CM_BASE = 'https://api.chartmetric.com/api'

const TARGET_STAGES = ['mid-level', 'mainstream', 'superstar', 'legendary']

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function getCMToken(): Promise<string> {
  const res = await fetch(`${CM_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshtoken: CM_REFRESH_TOKEN }),
  })
  const data = await res.json()
  if (!data.token) throw new Error('Failed to get CM token')
  return data.token
}

// GET handler for Vercel Cron
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runFestivalSync(request)
}

// POST handler for manual triggers
export async function POST(request: Request) {
  return runFestivalSync(request)
}

async function runFestivalSync(request: Request) {
  try {
    // Optional: ?limit=3 to test with fewer festivals
    const url = new URL(request.url)
    const festivalLimit = parseInt(url.searchParams.get('limit') || '100')

    const token = await getCMToken()

    // Step 1: Get upcoming large/mega US festivals
    const festParams = new URLSearchParams({
      'code2s[]': 'US',
      sortColumn: 'startDate',
      sortOrderDesc: 'false',
      limit: String(festivalLimit),
      offset: '0',
    })
    const festUrl = `${CM_BASE}/festival/list?${festParams.toString()}`

    const festRes = await fetch(festUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!festRes.ok) throw new Error(`Festival list failed: ${festRes.status}`)

    const festData = await festRes.json()
    const allFestivals = festData?.obj || []

    // Filter to future only
    const today = new Date().toISOString().split('T')[0]
    const festivals = allFestivals.filter((f: any) => {
      const d = f.date?.split(' ')[0]
      return d && d >= today
    })

    // Get existing data
    const { data: existingArtists } = await supabase
      .from('intel_artists').select('chartmetric_id')
    const existingIds = new Set((existingArtists || []).map(a => a.chartmetric_id))

    const { data: existingApps } = await supabase
      .from('festival_appearances').select('chartmetric_id, festival_cm_id')
    const existingAppKeys = new Set(
      (existingApps || []).map(a => `${a.chartmetric_id}|${a.festival_cm_id}`)
    )

    let totalNew = 0
    let totalApps = 0
    const artistFestCount: Record<number, number> = {}

    // Step 2: For each festival, get lineup
    for (const festival of festivals) {
      await sleep(1000)

      const params = new URLSearchParams({
        'eventIds[]': String(festival.id),
        limit: '100',
        offset: '0',
        sortColumn: 'sp_followers',
        sortOrderDesc: 'true',
      })

      const lineupRes = await fetch(
        `${CM_BASE}/artist/list/filter?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!lineupRes.ok) continue

      const lineupData = await lineupRes.json()
      const lineup = lineupData?.obj?.obj || lineupData?.obj || []

      const festDate = festival.date?.split(' ')[0] || null

      // Filter to mid-level+
      const targets = lineup.filter((a: any) => {
        const stage = a.career_status?.stage?.toLowerCase()
        return stage && TARGET_STAGES.includes(stage)
      })

      for (const artist of targets) {
        const cmId = parseInt(artist.cm_artist)
        if (isNaN(cmId)) continue

        artistFestCount[cmId] = (artistFestCount[cmId] || 0) + 1

        // New artist — full CM enrichment
        if (!existingIds.has(cmId)) {
          // Pull full profile for cm_score, demographics, genre
          await sleep(500)
          let profile: Record<string, any> = {}
          try {
            const profRes = await fetch(`${CM_BASE}/artist/${cmId}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (profRes.ok) {
              profile = (await profRes.json())?.obj || {}
            }
          } catch { /* use lineup data as fallback */ }

          // Pull career stage (confirms score)
          await sleep(500)
          let careerStage = artist.career_status?.stage || null
          let cmScore = profile.cm_artist_score || null
          try {
            const careerRes = await fetch(`${CM_BASE}/artist/${cmId}/career?limit=1`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (careerRes.ok) {
              const careerData = (await careerRes.json())?.obj?.[0]
              if (careerData?.stage) careerStage = careerData.stage
            }
          } catch { /* use lineup career stage */ }

          // Pull Spotify ID from URLs
          await sleep(500)
          let spotifyArtistId: string | null = null
          try {
            const urlsRes = await fetch(`${CM_BASE}/artist/${cmId}/urls`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (urlsRes.ok) {
              const urlsData = (await urlsRes.json())?.obj || []
              const spEntry = urlsData.find((u: any) => u.domain === 'spotify')
              if (spEntry?.url?.[0]) {
                const spUrl = spEntry.url[0]
                const spMatch = spUrl.match(/artist\/([a-zA-Z0-9]+)/)
                if (spMatch) spotifyArtistId = spMatch[1]
              }
            }
          } catch { /* skip */ }

          const { error } = await supabase.from('intel_artists').insert({
            chartmetric_id: cmId,
            name: profile.name || artist.name,
            image_url: profile.image_url || artist.image_url || null,
            cm_score: cmScore,
            career_stage: careerStage,
            primary_genre: profile.artist_genres?.[0]?.name || artist.genres?.split(',')[0]?.trim() || null,
            spotify_followers: profile.sp_followers || artist.sp_followers || null,
            spotify_monthly_listeners: profile.sp_monthly_listeners || artist.sp_monthly_listeners || null,
            instagram_followers: profile.ins_followers || artist.ins_followers || null,
            youtube_subscribers: profile.ycs_subscribers || artist.ycs_subscribers || null,
            tiktok_followers: profile.tiktok_followers || artist.tiktok_followers || null,
            audience_male_pct: profile.sp_fans_male_pct || null,
            audience_female_pct: profile.sp_fans_female_pct || null,
            spotify_artist_id: spotifyArtistId,
            source: 'festival_signal',
            is_active: true,
            cm_last_refreshed_at: new Date().toISOString(),
          })
          if (!error) {
            existingIds.add(cmId)

            // Pull brand affinities
            await sleep(500)
            try {
              const brandRes = await fetch(`${CM_BASE}/artist/${cmId}/instagram-audience-data?field=brandAffinity`, {
                headers: { Authorization: `Bearer ${token}` },
              })
              if (brandRes.ok) {
                const brands = ((await brandRes.json())?.obj || []).filter((b: any) => b.affinity >= 1.0)
                if (brands.length) {
                  await supabase.from('intel_artist_brand_affinities').insert(
                    brands.map((b: any) => ({
                      chartmetric_id: cmId,
                      brand_id: b.id || 0,
                      brand_name: b.name,
                      affinity_scale: b.affinity,
                      follower_count: b.followers || null,
                      interest_category: b.category || null,
                    }))
                  )
                }
              }
            } catch { /* skip */ }

            // Pull sector affinities
            await sleep(500)
            try {
              const sectorRes = await fetch(`${CM_BASE}/artist/${cmId}/instagram-audience-data?field=interests`, {
                headers: { Authorization: `Bearer ${token}` },
              })
              if (sectorRes.ok) {
                const sectors = ((await sectorRes.json())?.obj || []).filter((s: any) => s.affinity >= 1.0)
                if (sectors.length) {
                  await supabase.from('intel_artist_sector_affinities').insert(
                    sectors.map((s: any) => ({
                      chartmetric_id: cmId,
                      sector_id: s.id || 0,
                      sector_name: s.name,
                      affinity_scale: s.affinity,
                    }))
                  )
                }
              }
            } catch { /* skip */ }
            totalNew++
            await supabase.from('activity_log').insert({
              chartmetric_id: cmId,
              event_type: 'added_to_pipeline',
              event_title: `Discovered via ${festival.name} lineup`,
              event_detail: { festival_name: festival.name, festival_size: festival.eventSize },
              event_date: festDate,
            })
          }
        }

        // Festival appearance
        const appKey = `${cmId}|${festival.id}`
        if (!existingAppKeys.has(appKey)) {
          const { error } = await supabase.from('festival_appearances').insert({
            chartmetric_id: cmId,
            festival_cm_id: festival.id,
            festival_name: festival.name,
            festival_date: festDate,
            festival_location: `${festival.city}, ${festival.country}`,
            festival_size: festival.eventSize,
          })
          if (!error) {
            existingAppKeys.add(appKey)
            totalApps++
            await supabase.from('activity_log').insert({
              chartmetric_id: cmId,
              event_type: 'festival_added',
              event_title: `Added to ${festival.name} lineup`,
              event_detail: {
                festival_name: festival.name,
                festival_cm_id: festival.id,
                festival_size: festival.eventSize,
                festival_location: `${festival.city}, ${festival.country}`,
              },
              event_date: festDate,
            })

            // Resurface artist if they were dismissed or lost
            await resurfaceIfHidden(supabase, cmId, 'festival_added')
          }
        }
      }
    }

    const highPriority = Object.values(artistFestCount).filter(c => c >= 2).length

    return NextResponse.json({
      success: true,
      festivals_scanned: festivals.length,
      new_artists: totalNew,
      appearances_logged: totalApps,
      high_priority_artists: highPriority,
      estimated_credits: 1 + festivals.length,
    })
  } catch (err: any) {
    console.error('Festival monitor failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
