import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getSpotifyToken, getLatestAlbum } from '@/lib/spotify'
import { resurfaceIfHidden } from '@/lib/signals'

// ── Genre → album cycle length (months) ─────────────
// Urban genres: ~12 months between albums
// Everything else (pop, rock, country, etc.): ~18 months
const URBAN_GENRES = new Set([
  'hip hop', 'hip-hop', 'rap', 'r&b', 'latin', 'reggaeton',
  'trap', 'drill', 'afrobeats', 'dancehall',
])
const URBAN_CYCLE_MONTHS = 12
const DEFAULT_CYCLE_MONTHS = 18

// Signal fires when predicted next release is within this window
const SIGNAL_WINDOW_MONTHS = 3

function getCycleMonths(genre: string | null): number {
  if (!genre) return DEFAULT_CYCLE_MONTHS
  const g = genre.toLowerCase()
  // Check exact match first, then check if any urban keyword appears in the genre string
  // (handles compound genres like "hip-hop/rap", "latin pop", etc.)
  if (URBAN_GENRES.has(g)) return URBAN_CYCLE_MONTHS
  for (const urban of URBAN_GENRES) {
    if (g.includes(urban)) return URBAN_CYCLE_MONTHS
  }
  return DEFAULT_CYCLE_MONTHS
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// ── GET: Check album cycles and generate signals ─────
// Also supports ?backfill=true to populate last_album_release_date
// from Spotify for artists that don't have it yet
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const backfill = url.searchParams.get('backfill') === 'true'
    const limit = parseInt(url.searchParams.get('limit') || '500')

    // ── Backfill mode: populate last_album_release_date from Spotify ──
    if (backfill) {
      const { data: artists, error } = await supabase
        .from('intel_artists')
        .select('chartmetric_id, name, spotify_artist_id')
        .not('spotify_artist_id', 'is', null)
        .is('last_album_release_date', null)
        .limit(limit)

      if (error) throw new Error(error.message)
      if (!artists?.length) {
        return NextResponse.json({ message: 'No artists need backfill', count: 0 })
      }

      const spToken = await getSpotifyToken()
      let filled = 0
      let skipped = 0

      for (const artist of artists) {
        try {
          const latest = await getLatestAlbum(spToken, artist.spotify_artist_id!)
          if (latest) {
            await supabase
              .from('intel_artists')
              .update({
                last_album_release_date: latest.release_date,
                last_album_name: latest.name,
              })
              .eq('chartmetric_id', artist.chartmetric_id)
            filled++
            console.log(`Backfill: ${artist.name} → "${latest.name}" (${latest.release_date})`)
          } else {
            skipped++
          }
          // Rate limit — Spotify free tier
          await new Promise(r => setTimeout(r, 200))
        } catch (err) {
          console.error(`Backfill failed for ${artist.name}:`, err)
          skipped++
        }
      }

      return NextResponse.json({
        mode: 'backfill',
        total: artists.length,
        filled,
        skipped,
      })
    }

    // ── Normal mode: check cycles and generate activity signals ──
    const { data: artists, error } = await supabase
      .from('intel_artists')
      .select('chartmetric_id, name, primary_genre, last_album_release_date, last_album_name')
      .not('last_album_release_date', 'is', null)
      .eq('is_active', true)
      .limit(limit)

    if (error) throw new Error(error.message)
    if (!artists?.length) {
      return NextResponse.json({ message: 'No artists with album data', count: 0 })
    }

    // Load existing album_cycle_signal entries to deduplicate
    const { data: existingSignals } = await supabase
      .from('activity_log')
      .select('chartmetric_id, event_detail')
      .eq('event_type', 'album_cycle_signal')

    const existingSet = new Set<string>()
    for (const sig of existingSignals || []) {
      const predicted = (sig.event_detail as Record<string, unknown>)?.predicted_next as string | undefined
      if (predicted) {
        existingSet.add(`${sig.chartmetric_id}:${predicted}`)
      }
    }

    // Load artists that already have an active pre-save signal
    // Real data beats predictions — skip these artists entirely
    const { data: activePresaves } = await supabase
      .from('activity_log')
      .select('chartmetric_id, event_date')
      .eq('event_type', 'album_presave')
      .gte('event_date', new Date().toISOString().split('T')[0])

    const presaveArtists = new Set<number>()
    for (const ps of activePresaves || []) {
      presaveArtists.add(ps.chartmetric_id)
    }

    const now = new Date()
    const windowEnd = addMonths(now, SIGNAL_WINDOW_MONTHS)
    let created = 0
    let tooEarly = 0
    let alreadyExists = 0
    let hasPresave = 0

    for (const artist of artists) {
      // Skip if artist already has an active pre-save — real data beats prediction
      if (presaveArtists.has(artist.chartmetric_id)) {
        hasPresave++
        continue
      }

      const releaseDate = new Date(artist.last_album_release_date!)
      const cycleMonths = getCycleMonths(artist.primary_genre)
      const predictedNext = addMonths(releaseDate, cycleMonths)

      // Only signal if predicted date is within the 3-month window ahead
      // Also allow up to 1 month past (artist might be "overdue")
      const oneMonthAgo = addMonths(now, -1)
      if (predictedNext < oneMonthAgo || predictedNext > windowEnd) {
        tooEarly++
        continue
      }

      const predictedDateStr = predictedNext.toISOString().split('T')[0]
      const dedupeKey = `${artist.chartmetric_id}:${predictedDateStr}`

      if (existingSet.has(dedupeKey)) {
        alreadyExists++
        continue
      }

      const { error: insertError } = await supabase.from('activity_log').insert({
        chartmetric_id: artist.chartmetric_id,
        event_type: 'album_cycle_signal',
        event_title: `Album Cycle: ~${formatMonthYear(predictedNext)} (based on "${artist.last_album_name}")`,
        event_detail: {
          last_album: artist.last_album_name,
          last_release: artist.last_album_release_date,
          predicted_next: predictedDateStr,
          cycle_months: cycleMonths,
          genre: artist.primary_genre,
        },
        event_date: predictedDateStr,
      })

      if (insertError) {
        console.error(`Signal insert failed for ${artist.name}:`, insertError.message)
      } else {
        created++
        console.log(`Signal: ${artist.name} → predicted ~${formatMonthYear(predictedNext)}`)

        // Resurface artist if they were dismissed or lost
        await resurfaceIfHidden(supabase, artist.chartmetric_id, 'album_cycle')
      }
    }

    return NextResponse.json({
      mode: 'cycle_check',
      total: artists.length,
      created,
      already_exists: alreadyExists,
      skipped_has_presave: hasPresave,
      too_early: tooEarly,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Album cycle sync failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
