import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const search = url.searchParams.get('search') || ''
  const brand = url.searchParams.get('brand') || ''
  const stage = url.searchParams.get('stage') || ''
  const limit = parseInt(url.searchParams.get('limit') || '50')
  const offset = parseInt(url.searchParams.get('offset') || '0')

  try {
    // If filtering by brand, we need to join through brand affinities
    if (brand) {
      const { data, error } = await supabase
        .from('intel_brand_affinities')
        .select(`
          brand_name,
          affinity_scale,
          follower_count,
          intel_artists!inner (
            chartmetric_id,
            name,
            image_url,
            career_stage,
            cm_score,
            spotify_followers,
            instagram_followers,
            tiktok_followers,
            primary_genre,
            audience_male_pct,
            audience_female_pct,
            age_18_24_pct,
            age_25_34_pct,
            age_35_44_pct,
            top_countries
          )
        `)
        .ilike('brand_name', `%${brand}%`)
        .gte('affinity_scale', 1.0)
        .order('affinity_scale', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) throw error

      // Flatten the response
      const artists = (data || []).map((row: any) => ({
        ...row.intel_artists,
        brand_match: {
          brand_name: row.brand_name,
          affinity_scale: row.affinity_scale,
          follower_count: row.follower_count,
        },
      }))

      return NextResponse.json({ artists, count: artists.length })
    }

    // Standard artist query
    let query = supabase
      .from('intel_artists')
      .select('*', { count: 'exact' })
      .not('cm_last_refreshed_at', 'is', null)

    if (search) {
      query = query.ilike('name', `%${search}%`)
    }

    if (stage) {
      query = query.eq('career_stage', stage)
    }

    query = query
      .order('cm_score', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) throw error

    return NextResponse.json({ artists: data || [], count })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
