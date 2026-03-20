import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const brand = url.searchParams.get('brand') || ''
  const sector = url.searchParams.get('sector') || ''
  const gender = url.searchParams.get('gender') || 'any' // 'male' | 'female' | 'any'
  const threshold = parseFloat(url.searchParams.get('threshold') || '0')
  const ages = url.searchParams.get('ages')?.split(',').filter(Boolean) || []

  try {
    // 1. Get all artists with demographic data
    const { data: artists, error: artistError } = await supabase
      .from('intel_artists')
      .select(`
        chartmetric_id, name, image_url, career_stage, cm_score,
        primary_genre, spotify_followers, instagram_followers, tiktok_followers,
        audience_male_pct, audience_female_pct,
        age_13_17_pct, age_18_24_pct, age_25_34_pct,
        age_35_44_pct, age_45_64_pct, age_65_plus_pct
      `)
      .not('cm_last_refreshed_at', 'is', null)

    if (artistError) throw artistError

    // 2. Get brand/sector affinities if specified
    let affinityMap = new Map<number, number>()

    if (brand) {
      // Search brand affinities
      const { data: brandData } = await supabase
        .from('intel_brand_affinities')
        .select('chartmetric_id, affinity_scale')
        .ilike('brand_name', `%${brand}%`)
        .gte('affinity_scale', 1.0)

      for (const row of brandData || []) {
        const existing = affinityMap.get(row.chartmetric_id) || 0
        if (row.affinity_scale > existing) {
          affinityMap.set(row.chartmetric_id, row.affinity_scale)
        }
      }

      // Also search sector affinities with the same query
      const { data: sectorData } = await supabase
        .from('intel_sector_affinities')
        .select('chartmetric_id, affinity_scale')
        .ilike('sector_name', `%${brand}%`)
        .gte('affinity_scale', 1.0)

      for (const row of sectorData || []) {
        const existing = affinityMap.get(row.chartmetric_id) || 0
        if (row.affinity_scale > existing) {
          affinityMap.set(row.chartmetric_id, row.affinity_scale)
        }
      }
    }

    // 3. Score each artist
    const AGE_FIELD_MAP: Record<string, string> = {
      '13-17': 'age_13_17_pct',
      '18-24': 'age_18_24_pct',
      '25-34': 'age_25_34_pct',
      '35-44': 'age_35_44_pct',
      '45-64': 'age_45_64_pct',
      '65+':   'age_65_plus_pct',
    }

    const results = (artists || []).map((artist: any) => {
      // Calculate combined age % for selected ranges
      let totalAgePct = 0
      if (ages.length > 0) {
        for (const age of ages) {
          const field = AGE_FIELD_MAP[age]
          if (field) totalAgePct += artist[field] || 0
        }
      } else {
        // No age filter = 100%
        totalAgePct = 100
      }

      // Apply gender split (Scenario A)
      let demographicPct = totalAgePct
      if (gender === 'female') {
        demographicPct = totalAgePct * ((artist.audience_female_pct || 50) / 100)
      } else if (gender === 'male') {
        demographicPct = totalAgePct * ((artist.audience_male_pct || 50) / 100)
      }

      const affinityScore = affinityMap.get(artist.chartmetric_id) || 0

      // Combined score: 60% demographic, 40% brand affinity (normalized to 0-100)
      // If no brand/sector specified, 100% demographic
      const hasBrandFilter = brand || sector
      const normalizedAffinity = Math.min((affinityScore / 4) * 100, 100) // 4x = max expected
      const combinedScore = hasBrandFilter
        ? (demographicPct * 0.6) + (normalizedAffinity * 0.4)
        : demographicPct

      return {
        ...artist,
        demographic_pct: Math.round(demographicPct * 10) / 10,
        affinity_score: affinityScore,
        combined_score: Math.round(combinedScore * 10) / 10,
      }
    })
    .filter((a: any) => {
      // Must meet demographic threshold
      if (ages.length > 0 || gender !== 'any') {
        if (a.demographic_pct < threshold) return false
      }
      // If brand/sector specified, must have some affinity
      if ((brand || sector) && a.affinity_score === 0) return false
      // Must have demographic data if filtering by age/gender
      if (ages.length > 0 && a.age_18_24_pct === null) return false
      return true
    })
    .sort((a: any, b: any) => b.combined_score - a.combined_score)
    .slice(0, 100)

    return NextResponse.json({ artists: results, count: results.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
