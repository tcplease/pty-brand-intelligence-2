import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const HIDDEN_STAGES = ['Lost']
const DIMMED_STAGES = ['Outbound - No Contact', 'Outbound - Automated Contact']

export async function GET(request: Request) {
  const url = new URL(request.url)
  const search = url.searchParams.get('search') || ''
  const brand = url.searchParams.get('brand') || ''
  const limit = parseInt(url.searchParams.get('limit') || '500')
  const offset = parseInt(url.searchParams.get('offset') || '0')

  try {
    // Get the best (highest priority) stage per artist from Monday items.
    // We use a priority order — Won > Finalizing > Negotiation > Proposal > Active > Prospect > Outbound > Lost
    // In practice: we just need to know if ALL items are Lost (hide) or if ANY are Outbound (dim).
    // Strategy: get distinct chartmetric_ids and their "best" stage per artist.
    const { data: mondayStages, error: mondayError } = await supabase
      .from('intel_monday_items')
      .select('chartmetric_id, stage')
      .not('chartmetric_id', 'is', null)

    if (mondayError) throw mondayError

    // Build a map: chartmetric_id → best visible stage
    // An artist is hidden if ALL their deals are Lost
    // An artist is dimmed if their best non-Lost deal is an Outbound stage
    const stageMap = new Map<number, { bestStage: string | null; allLost: boolean; isDimmed: boolean }>()

    for (const item of mondayStages || []) {
      const id = item.chartmetric_id as number
      const stage = item.stage as string | null
      const existing = stageMap.get(id)

      if (!existing) {
        stageMap.set(id, {
          bestStage: stage,
          allLost: stage === 'Lost' || stage === null,
          isDimmed: DIMMED_STAGES.includes(stage || ''),
        })
      } else {
        // If this stage is not Lost, mark as not allLost
        if (stage !== 'Lost' && stage !== null) {
          existing.allLost = false
          // If this stage is better than outbound, mark as not dimmed
          if (!DIMMED_STAGES.includes(stage)) {
            existing.isDimmed = false
            existing.bestStage = stage
          }
        }
      }
    }

    // Set of hidden IDs (all deals are Lost)
    const hiddenIds = new Set<number>()
    const dimmedIds = new Set<number>()

    stageMap.forEach((info, id) => {
      if (info.allLost) hiddenIds.add(id)
      else if (info.isDimmed) dimmedIds.add(id)
    })

    // Brand filter path
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
            primary_genre
          )
        `)
        .ilike('brand_name', `%${brand}%`)
        .gte('affinity_scale', 1.0)
        .order('affinity_scale', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) throw error

      const artists = (data || [])
        .map((row: any) => ({
          ...row.intel_artists,
          brand_match: {
            brand_name: row.brand_name,
            affinity_scale: row.affinity_scale,
            follower_count: row.follower_count,
          },
          is_dimmed: dimmedIds.has(row.intel_artists.chartmetric_id),
          deal_stage: stageMap.get(row.intel_artists.chartmetric_id)?.bestStage ?? null,
        }))
        .filter((a: any) => !hiddenIds.has(a.chartmetric_id))

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

    query = query
      .order('cm_score', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) throw error

    // Apply visibility logic
    const artists = (data || [])
      .filter((a: any) => !hiddenIds.has(a.chartmetric_id))
      .map((a: any) => ({
        ...a,
        is_dimmed: dimmedIds.has(a.chartmetric_id),
        deal_stage: stageMap.get(a.chartmetric_id)?.bestStage ?? null,
      }))

    return NextResponse.json({ artists, count: artists.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
