import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const HIDDEN_STAGES = ['Lost', 'Tour Canceled', 'Fell Off (Not Lost)']
const DIMMED_STAGES = ['Outbound - No Contact', 'Outbound - Automated Contact']

// Higher number = better stage (used to pick the "best" deal for display)
const STAGE_PRIORITY: Record<string, number> = {
  'Lost': 0,
  'Tour Canceled': 1,
  'Fell Off (Not Lost)': 2,
  'Outbound - No Contact': 3,
  'Outbound - Automated Contact': 4,
  'Prospect - Direct Sales Agent Contact': 5,
  'Active Leads (Contact Has Responded)': 6,
  'Proposal (financials submitted)': 7,
  'Negotiation (Terms Being Discussed)': 8,
  'Finalizing On-Sale (Terms Agreed)': 9,
  'Won (Final On-Sale Planned)': 10,
}
function stagePriority(stage: string | null): number {
  return stage ? (STAGE_PRIORITY[stage] ?? -1) : -1
}

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
      .select('chartmetric_id, stage, last_show, sales_lead')
      .not('chartmetric_id', 'is', null)

    if (mondayError) throw mondayError

    // Build a map: chartmetric_id → best visible stage
    // Rules:
    //   - A deal is "inactive" if it's in HIDDEN_STAGES OR expired (last_show in the past)
    //   - An artist is HIDDEN if ALL their deals are inactive
    //   - An artist is DIMMED if their best active deal is an Outbound stage
    //   - The displayed stage is the highest-priority ACTIVE deal
    //   - Deals with no last_show are treated as active
    const today = new Date().toISOString().split('T')[0]
    const stageMap = new Map<number, { bestStage: string | null; allInactive: boolean; isDimmed: boolean; salesLeads: Set<string> }>()

    for (const item of mondayStages || []) {
      const id = item.chartmetric_id as number
      const stage = item.stage as string | null
      const lastShow = item.last_show as string | null

      const isHiddenStage = stage === null || HIDDEN_STAGES.includes(stage)
      const isExpired = lastShow != null && lastShow < today
      const isInactive = isHiddenStage || isExpired

      // Extract sales leads from this item
      const itemLeads = (item as Record<string, unknown>).sales_lead as string | null
      const leadNames = itemLeads ? itemLeads.split(',').map((s: string) => s.trim()).filter(Boolean) : []

      const existing = stageMap.get(id)

      if (!existing) {
        stageMap.set(id, {
          bestStage: isInactive ? null : stage,
          allInactive: isInactive,
          isDimmed: !isInactive && DIMMED_STAGES.includes(stage || ''),
          salesLeads: new Set(leadNames),
        })
      } else {
        // Add sales leads from this deal too
        leadNames.forEach((n: string) => existing.salesLeads.add(n))
        if (!isInactive) {
          // This deal is active — artist should be visible
          existing.allInactive = false
          if (!DIMMED_STAGES.includes(stage!)) {
            existing.isDimmed = false
          }
          // Keep the highest-priority active deal for display
          if (stagePriority(stage) > stagePriority(existing.bestStage)) {
            existing.bestStage = stage
          }
        }
      }
    }

    // Set of hidden IDs (all deals are Lost)
    const hiddenIds = new Set<number>()
    const dimmedIds = new Set<number>()

    stageMap.forEach((info, id) => {
      if (info.allInactive) hiddenIds.add(id)
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
          sales_leads: Array.from(stageMap.get(row.intel_artists.chartmetric_id)?.salesLeads ?? []),
        }))
        .filter((a: any) => !hiddenIds.has(a.chartmetric_id))

      return NextResponse.json({ artists, count: artists.length })
    }

    // Standard artist query — only pipeline artists (not discovery/new)
    let query = supabase
      .from('intel_artists')
      .select('*', { count: 'exact' })
      .not('cm_last_refreshed_at', 'is', null)
      .eq('discovery_status', 'pipeline')

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
        sales_leads: Array.from(stageMap.get(a.chartmetric_id)?.salesLeads ?? []),
      }))

    return NextResponse.json({ artists, count: artists.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
