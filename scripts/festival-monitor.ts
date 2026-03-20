// scripts/festival-monitor.ts
// Run with: npx tsx scripts/festival-monitor.ts
// Test with: npx tsx scripts/festival-monitor.ts 3  (scans only 3 festivals)
//
// Cost: ~1 credit per festival + 1 for the list

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CM_REFRESH_TOKEN = process.env.CHARTMETRIC_TOKEN!
const CM_BASE = 'https://api.chartmetric.com/api'

// Career stages we care about (mid-level and above)
const TARGET_STAGES = ['mid-level', 'mainstream', 'superstar', 'legendary']

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Auth ──────────────────────────────────────────────
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

// ── Step 1: Get upcoming US festivals sorted by popularity ──
interface Festival {
  id: number
  name: string
  date: string
  numberOfDays: number
  city: string
  country: string
  performersCount: number
  popularityRank: number
  eventSize: string
}

async function getFestivals(token: string): Promise<Festival[]> {
  // Sort by rank (most popular first), US only
  const url = `${CM_BASE}/festival/list?code2s[]=US&sortColumn=rank&sortOrderDesc=false&limit=100&offset=0`

  console.log('Fetching US festivals (sorted by popularity)...')
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Festival list failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  const festivals: Festival[] = data?.obj || []

  // Filter to future festivals only
  const today = new Date().toISOString().split('T')[0]
  const upcoming = festivals.filter(f => {
    const festDate = f.date?.split(' ')[0]
    return festDate && festDate >= today
  })

  console.log(`Found ${festivals.length} total, ${upcoming.length} upcoming`)
  return upcoming
}

// ── Step 2: Get artist lineup for a festival ──────────
interface CMFilterArtist {
  cm_artist: string
  name: string
  image_url: string | null
  code2: string | null
  career_status?: {
    stage?: string
    trend?: string
  }
  sp_followers?: number
  sp_monthly_listeners?: number
  ins_followers?: number
  ycs_subscribers?: number
  tiktok_followers?: number
  genres?: string
}

async function getFestivalLineup(festivalId: number, token: string): Promise<CMFilterArtist[]> {
  const allArtists: CMFilterArtist[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const url = `${CM_BASE}/artist/list/filter?eventIds[]=${festivalId}&limit=${limit}&offset=${offset}&sortColumn=cm_artist_rank&sortOrderDesc=false`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error(`  Lineup fetch failed for festival ${festivalId} (${res.status}): ${errText.slice(0, 200)}`)
      break
    }

    const data = await res.json()
    const raw = Array.isArray(data?.obj) ? data.obj : Array.isArray(data?.obj?.obj) ? data.obj.obj : []
    const artists: CMFilterArtist[] = raw

    if (artists.length === 0) break

    allArtists.push(...artists)

    if (artists.length < limit) break

    offset += limit
    await sleep(500)
  }

  return allArtists
}

// ── Step 3: Main pipeline ─────────────────────────────
export async function runFestivalMonitor(maxFestivals?: number) {
  console.log('=== Festival Monitor Starting ===')
  console.log(`Date: ${new Date().toISOString()}`)

  const token = await getCMToken()
  console.log('CM token acquired')

  // Step 1: Get festivals
  const festivals = await getFestivals(token)
  if (festivals.length === 0) {
    console.log('No upcoming festivals found. Done.')
    return { festivals: 0, newArtists: 0, appearances: 0, highPriority: 0 }
  }

  // Get existing artists from our DB
  const { data: existingArtists } = await supabase
    .from('intel_artists')
    .select('chartmetric_id')
  const existingIds = new Set((existingArtists || []).map(a => a.chartmetric_id))

  // Get existing festival appearances to avoid duplicates
  const { data: existingAppearances } = await supabase
    .from('festival_appearances')
    .select('chartmetric_id, festival_cm_id')
  const existingAppKeys = new Set(
    (existingAppearances || []).map(a => `${a.chartmetric_id}|${a.festival_cm_id}`)
  )

  const scanList = maxFestivals ? festivals.slice(0, maxFestivals) : festivals
  console.log(`Scanning ${scanList.length} of ${festivals.length} festivals${maxFestivals ? ' (test mode)' : ''}`)

  let totalNewArtists = 0
  let totalAppearances = 0
  const artistFestivalCount: Record<number, number> = {}

  // Step 2: For each festival, get lineup
  for (const festival of scanList) {
    const sizeLabel = festival.eventSize ? ` — ${festival.eventSize}` : ''
    console.log(`\n📍 ${festival.name} (${festival.city})${sizeLabel}`)
    console.log(`   Rank: #${festival.popularityRank} | ${festival.performersCount} performers | ${festival.date?.split(' ')[0]}`)

    await sleep(1000)

    const lineup = await getFestivalLineup(festival.id, token)
    console.log(`   Lineup: ${lineup.length} artists returned`)

    // Filter to target career stages
    const targetArtists = lineup.filter(a => {
      const stage = a.career_status?.stage?.toLowerCase()
      return stage && TARGET_STAGES.includes(stage)
    })
    console.log(`   Mid-level+: ${targetArtists.length} artists`)

    const festDate = festival.date?.split(' ')[0] || null

    for (const artist of targetArtists) {
      const cmId = parseInt(artist.cm_artist)
      if (isNaN(cmId)) continue

      artistFestivalCount[cmId] = (artistFestivalCount[cmId] || 0) + 1

      // Insert new artist if not in our DB
      if (!existingIds.has(cmId)) {
        const { error: insertError } = await supabase
          .from('intel_artists')
          .insert({
            chartmetric_id: cmId,
            name: artist.name,
            image_url: artist.image_url || null,
            career_stage: artist.career_status?.stage || null,
            primary_genre: artist.genres || null,
            spotify_followers: artist.sp_followers || null,
            spotify_monthly_listeners: artist.sp_monthly_listeners || null,
            instagram_followers: artist.ins_followers || null,
            youtube_subscribers: artist.ycs_subscribers || null,
            tiktok_followers: artist.tiktok_followers || null,
            source: 'festival_signal',
            is_active: true,
          })

        if (insertError) {
          if (!insertError.message.includes('duplicate')) {
            console.error(`   ✗ Failed to insert ${artist.name}: ${insertError.message}`)
          }
        } else {
          existingIds.add(cmId)
          totalNewArtists++
          console.log(`   ✚ NEW: ${artist.name} (${artist.career_status?.stage})`)

          await supabase.from('activity_log').insert({
            chartmetric_id: cmId,
            event_type: 'added_to_pipeline',
            event_title: `Discovered via ${festival.name} lineup`,
            event_detail: {
              festival_name: festival.name,
              festival_size: festival.eventSize || null,
              career_stage: artist.career_status?.stage,
            },
            event_date: festDate,
          })
        }
      }

      // Insert festival appearance (if not already recorded)
      const appKey = `${cmId}|${festival.id}`
      if (!existingAppKeys.has(appKey)) {
        const { error: appError } = await supabase
          .from('festival_appearances')
          .insert({
            chartmetric_id: cmId,
            festival_cm_id: festival.id,
            festival_name: festival.name,
            festival_date: festDate,
            festival_location: `${festival.city}, ${festival.country}`,
            festival_size: festival.eventSize || null,
          })

        if (!appError) {
          existingAppKeys.add(appKey)
          totalAppearances++

          await supabase.from('activity_log').insert({
            chartmetric_id: cmId,
            event_type: 'festival_added',
            event_title: `Added to ${festival.name} lineup`,
            event_detail: {
              festival_name: festival.name,
              festival_cm_id: festival.id,
              festival_size: festival.eventSize || null,
              festival_location: `${festival.city}, ${festival.country}`,
            },
            event_date: festDate,
          })
        }
      }
    }
  }

  // Step 3: Flag multi-festival artists (2+ festivals)
  const highPriority = Object.entries(artistFestivalCount)
    .filter(([_, count]) => count >= 2)
    .map(([cmId, count]) => ({ cmId: parseInt(cmId), count }))

  if (highPriority.length > 0) {
    console.log(`\n🔥 HIGH PRIORITY — Artists at 2+ festivals:`)
    for (const { cmId, count } of highPriority) {
      const { data: a } = await supabase
        .from('intel_artists')
        .select('name')
        .eq('chartmetric_id', cmId)
        .single()
      console.log(`   ${a?.name ?? cmId} — ${count} festivals`)
    }
  }

  // Summary
  console.log('\n=== Festival Monitor Complete ===')
  console.log(`Festivals scanned: ${scanList.length}`)
  console.log(`New artists added: ${totalNewArtists}`)
  console.log(`Festival appearances logged: ${totalAppearances}`)
  console.log(`High-priority (2+ festivals): ${highPriority.length}`)
  console.log(`Estimated credits used: ~${1 + scanList.length}`)

  return {
    festivals: scanList.length,
    newArtists: totalNewArtists,
    appearances: totalAppearances,
    highPriority: highPriority.length,
  }
}

// Run if called directly — pass a number to limit festivals for testing
const testLimit = parseInt(process.argv[2] || '0')
runFestivalMonitor(testLimit || undefined).catch(console.error)
