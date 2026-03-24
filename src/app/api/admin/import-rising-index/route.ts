import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Papa from 'papaparse'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RiCsvRow {
  Artist: string
  Country: string
  Region: string
  Pronouns: string
  Genres: string
  'Career Stage': string
  'Recent Momentum': string
  'First Release Date': string
  'Latest Release Date': string
  'Consistent Growth': string
  'Synchronous Growth': string
  'User Engagement': string
  'User Curation': string
  'Editorial Curation': string
  'Trigger Cities': string
  'International Development': string
  'Audience Concentration': string
}

function parseScore(val: string): number | null {
  if (!val || val.trim() === '') return null
  const n = parseInt(val.trim(), 10)
  return isNaN(n) ? null : n
}

async function getChartmetricToken(): Promise<string | null> {
  try {
    const res = await fetch('https://api.chartmetric.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshtoken: process.env.CHARTMETRIC_TOKEN }),
    })
    const data = await res.json()
    return data.token ?? null
  } catch {
    return null
  }
}

async function searchChartmetric(name: string, token: string): Promise<{ id: number; name: string } | null> {
  try {
    const res = await fetch(
      `https://api.chartmetric.com/api/artist/search?q=${encodeURIComponent(name)}&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = await res.json()
    const artists = data.obj?.artists || []
    if (artists.length === 0) return null

    // Exact name match first, then highest score
    const exact = artists.find((a: { name: string }) =>
      a.name.toLowerCase() === name.toLowerCase()
    )
    if (exact) return { id: exact.id, name: exact.name }

    // Return first result (highest relevance)
    return { id: artists[0].id, name: artists[0].name }
  } catch {
    return null
  }
}

async function pullFullArtistData(cmId: number, token: string): Promise<Record<string, unknown> | null> {
  try {
    // Get basic artist data
    const res = await fetch(`https://api.chartmetric.com/api/artist/${cmId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    const a = data.obj

    if (!a) return null

    // Get career stage
    const careerRes = await fetch(`https://api.chartmetric.com/api/artist/${cmId}/career?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const careerData = await careerRes.json()
    const career = careerData.obj?.[0]

    // Get fan metrics for demographics
    const fanRes = await fetch(`https://api.chartmetric.com/api/artist/${cmId}/fan-metrics?source=spotify`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const fanData = await fanRes.json()
    const fan = fanData.obj

    // Parse top_genres from tags
    const topGenres = (a.tags?.top_genres || [])
      .map((g: string) => g.replace(/^'+|'+$/g, '').trim())
      .filter(Boolean)

    return {
      name: a.name,
      image_url: a.image_url,
      primary_genre: topGenres[0] || a.genre_primary || null,
      top_genres: topGenres,
      career_stage: career?.stage || null,
      cm_score: a.cm_artist_score ?? career?.momentum_score ?? null,
      spotify_followers: a.sp_followers ?? null,
      spotify_monthly_listeners: a.sp_monthly_listeners ?? null,
      instagram_followers: a.ins_followers ?? null,
      youtube_subscribers: a.ycs_subscribers ?? null,
      tiktok_followers: a.tt_followers ?? null,
      audience_male_pct: fan?.gender?.male ?? null,
      audience_female_pct: fan?.gender?.female ?? null,
      age_13_17_pct: fan?.age?.['13-17'] ?? null,
      age_18_24_pct: fan?.age?.['18-24'] ?? null,
      age_25_34_pct: fan?.age?.['25-34'] ?? null,
      age_35_44_pct: fan?.age?.['35-44'] ?? null,
      age_45_64_pct: fan?.age?.['45-64'] ?? null,
      age_65_plus_pct: fan?.age?.['65+'] ?? null,
      is_active: true,
      cm_last_refreshed_at: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const csvText = await file.text()
    const parsed = Papa.parse<RiCsvRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    })

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return NextResponse.json({
        error: 'CSV parsing failed',
        details: parsed.errors.slice(0, 5),
      }, { status: 400 })
    }

    const rows = parsed.data.filter(r => r.Artist && r.Artist.trim())

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid rows found in CSV' }, { status: 400 })
    }

    const token = await getChartmetricToken()
    if (!token) {
      return NextResponse.json({ error: 'Failed to authenticate with Chartmetric' }, { status: 500 })
    }

    const results = {
      total: rows.length,
      created: 0,
      updated: 0,
      failed: [] as { name: string; reason: string }[],
      ambiguous: [] as { name: string; matchedAs: string }[],
    }

    for (const row of rows) {
      const artistName = row.Artist.trim()

      // Build Rising Index scores
      const riScores = {
        ri_consistent_growth: parseScore(row['Consistent Growth']),
        ri_synchronous_growth: parseScore(row['Synchronous Growth']),
        ri_user_engagement: parseScore(row['User Engagement']),
        ri_user_curation: parseScore(row['User Curation']),
        ri_editorial_curation: parseScore(row['Editorial Curation']),
        ri_trigger_cities: parseScore(row['Trigger Cities']),
        ri_international_development: parseScore(row['International Development']),
        ri_audience_concentration: parseScore(row['Audience Concentration']),
        ri_last_updated_at: new Date().toISOString(),
        recent_momentum: row['Recent Momentum']?.trim() || null,
      }

      // Check if artist already exists by name
      const { data: existing } = await supabase
        .from('artists')
        .select('chartmetric_id, name, source')
        .ilike('name', artistName)
        .limit(1)
        .single()

      if (existing) {
        // Update existing artist with RI scores only
        await supabase
          .from('artists')
          .update(riScores)
          .eq('chartmetric_id', existing.chartmetric_id)

        // Log activity
        await supabase.from('activity_log').insert({
          chartmetric_id: existing.chartmetric_id,
          event_type: 'rising_index_signal',
          event_title: `Flagged by Rising Index${riScores.recent_momentum ? ' — ' + riScores.recent_momentum : ''}`,
          event_detail: riScores,
          event_date: new Date().toISOString().split('T')[0],
        })

        results.updated++
        continue
      }

      // New artist: search Chartmetric
      // Add small delay to respect rate limits
      await new Promise(r => setTimeout(r, 300))

      const cmMatch = await searchChartmetric(artistName, token)

      if (!cmMatch) {
        results.failed.push({ name: artistName, reason: 'Not found on Chartmetric' })
        continue
      }

      // Check if CM ID already exists (name mismatch)
      const { data: existingById } = await supabase
        .from('artists')
        .select('chartmetric_id, name')
        .eq('chartmetric_id', cmMatch.id)
        .limit(1)
        .single()

      if (existingById) {
        // Artist exists under different name, just update RI scores
        await supabase
          .from('artists')
          .update(riScores)
          .eq('chartmetric_id', cmMatch.id)

        await supabase.from('activity_log').insert({
          chartmetric_id: cmMatch.id,
          event_type: 'rising_index_signal',
          event_title: `Flagged by Rising Index${riScores.recent_momentum ? ' — ' + riScores.recent_momentum : ''}`,
          event_detail: riScores,
          event_date: new Date().toISOString().split('T')[0],
        })

        if (existingById.name.toLowerCase() !== artistName.toLowerCase()) {
          results.ambiguous.push({ name: artistName, matchedAs: existingById.name })
        }
        results.updated++
        continue
      }

      // Flag if name doesn't match exactly
      if (cmMatch.name.toLowerCase() !== artistName.toLowerCase()) {
        results.ambiguous.push({ name: artistName, matchedAs: cmMatch.name })
      }

      // Pull full CM data for new artist
      await new Promise(r => setTimeout(r, 500))
      const fullData = await pullFullArtistData(cmMatch.id, token)

      if (!fullData) {
        results.failed.push({ name: artistName, reason: 'Failed to pull Chartmetric data' })
        continue
      }

      // Insert new artist
      const { error: insertErr } = await supabase.from('artists').insert({
        chartmetric_id: cmMatch.id,
        ...fullData,
        ...riScores,
        source: 'rising_index',
        discovery_status: 'discovery',
      })

      if (insertErr) {
        results.failed.push({ name: artistName, reason: insertErr.message })
        continue
      }

      // Log activity
      await supabase.from('activity_log').insert({
        chartmetric_id: cmMatch.id,
        event_type: 'rising_index_signal',
        event_title: `Flagged by Rising Index${riScores.recent_momentum ? ' — ' + riScores.recent_momentum : ''}`,
        event_detail: riScores,
        event_date: new Date().toISOString().split('T')[0],
      })

      results.created++
    }

    return NextResponse.json(results)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
