import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getSpotifyToken, getArtistAlbums } from '@/lib/spotify'
import { resurfaceIfHidden } from '@/lib/signals'
import type { SpotifyAlbum } from '@/lib/spotify'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const FUTURE_DAYS = 90
const RECENT_DAYS = 14

export async function POST() {
  try {
    const supabase = createServiceClient()
    const token = await getSpotifyToken()

    const { data: artists, error: artistError } = await supabase
      .from('intel_artists')
      .select('chartmetric_id, name, spotify_artist_id')
      .not('spotify_artist_id', 'is', null)

    if (artistError) throw artistError
    if (!artists || artists.length === 0) {
      return NextResponse.json({ success: true, checked: 0, new_presaves: 0, message: 'No artists with Spotify IDs' })
    }

    console.log(`Checking ${artists.length} artists for upcoming releases...`)

    const { data: existingLogs } = await supabase
      .from('activity_log')
      .select('event_detail')
      .eq('event_type', 'album_presave')

    const existingAlbumIds = new Set<string>()
    for (const log of existingLogs || []) {
      const albumId = (log.event_detail as Record<string, unknown>)?.album_id as string | undefined
      if (albumId) existingAlbumIds.add(albumId)
    }

    const today = new Date()
    const futureLimit = new Date(today)
    futureLimit.setDate(futureLimit.getDate() + FUTURE_DAYS)
    const recentLimit = new Date(today)
    recentLimit.setDate(recentLimit.getDate() - RECENT_DAYS)

    let checked = 0
    let newPresaves = 0
    let errors = 0

    for (const artist of artists) {
      try {
        const albums = await getArtistAlbums(token, artist.spotify_artist_id!)

        const relevant = albums.filter((album: SpotifyAlbum) => {
          if (album.album_type === 'compilation') return false
          if (album.release_date_precision !== 'day') return false
          const releaseDate = new Date(album.release_date)
          if (releaseDate > today && releaseDate <= futureLimit) return true
          if (releaseDate >= recentLimit && releaseDate <= today) return true
          return false
        })

        for (const album of relevant) {
          if (existingAlbumIds.has(album.id)) continue

          const isUpcoming = new Date(album.release_date) > today
          const typeLabel = album.album_type === 'album' ? 'Album' : 'Single'
          const prefix = isUpcoming ? 'Upcoming' : 'New Release'

          await supabase.from('activity_log').insert({
            chartmetric_id: artist.chartmetric_id,
            event_type: 'album_presave',
            event_title: `${prefix}: "${album.name}" (${typeLabel})`,
            event_detail: {
              album_id: album.id,
              album_type: album.album_type,
              release_date: album.release_date,
              spotify_url: album.external_urls?.spotify ?? null,
              image_url: album.images?.[0]?.url ?? null,
              total_tracks: album.total_tracks,
            },
            event_date: album.release_date,
          })

          // If this is a full album (not a single), update the cycle tracker
          // and clear any stale album_cycle_signal predictions
          if (album.album_type === 'album') {
            await supabase
              .from('intel_artists')
              .update({
                last_album_release_date: album.release_date,
                last_album_name: album.name,
              })
              .eq('chartmetric_id', artist.chartmetric_id)

            // Remove outdated cycle predictions — real data overrides the guess
            await supabase
              .from('activity_log')
              .delete()
              .eq('chartmetric_id', artist.chartmetric_id)
              .eq('event_type', 'album_cycle_signal')

            console.log(`  🔄 ${artist.name}: cycle reset to "${album.name}" (${album.release_date})`)
          }

          existingAlbumIds.add(album.id)
          newPresaves++
          console.log(`  💿 ${artist.name}: ${prefix} — "${album.name}" (${album.release_date})`)

          // Resurface artist if they were dismissed or lost
          await resurfaceIfHidden(supabase, artist.chartmetric_id, 'album_presave')
        }

        checked++
        if (checked % 50 === 0) {
          console.log(`Checked ${checked}/${artists.length} artists...`)
        }

        await sleep(100)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`✗ ${artist.name}: ${message}`)
        errors++
        await sleep(200)
      }
    }

    console.log(`Spotify sync complete: ${checked} checked, ${newPresaves} new pre-saves, ${errors} errors`)

    return NextResponse.json({
      success: true,
      checked,
      new_presaves: newPresaves,
      errors,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Spotify sync failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
