import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Returns benchmark data for the merch risk algorithm
// - If artist_name is provided, returns that artist's benchmarks
// - Also returns aggregate stats by CM score band for comparison

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const artistName = url.searchParams.get('artist')

    // Get the specific artist's benchmarks if they exist
    let artistBenchmark = null
    if (artistName) {
      const { data } = await supabase
        .from('merch_artist_benchmarks')
        .select('*')
        .ilike('artist_name', artistName)
        .limit(1)

      if (data && data.length > 0) {
        artistBenchmark = data[0]
      }
    }

    // Get aggregate stats for CM score bands
    // We join with intel_artists to get cm_score, then bucket
    const { data: allBenchmarks } = await supabase
      .from('merch_artist_benchmarks')
      .select('artist_name, tm_total_orders, tm_total_revenue, tm_event_count, tm_avg_order_value, axs_total_orders, axs_total_revenue, axs_event_count, data_source')

    const { data: allArtists } = await supabase
      .from('intel_artists')
      .select('name, cm_score, career_stage')

    // Build a name->cm_score lookup
    const cmLookup: Record<string, { score: number | null; stage: string | null }> = {}
    for (const a of allArtists || []) {
      cmLookup[a.name.toLowerCase()] = { score: a.cm_score, stage: a.career_stage }
    }

    // Calculate score bands
    interface BandStats {
      count: number
      totalRevenue: number
      totalOrders: number
      artists: string[]
    }

    const bands: Record<string, BandStats> = {
      '90+': { count: 0, totalRevenue: 0, totalOrders: 0, artists: [] },
      '80-89': { count: 0, totalRevenue: 0, totalOrders: 0, artists: [] },
      '70-79': { count: 0, totalRevenue: 0, totalOrders: 0, artists: [] },
      '60-69': { count: 0, totalRevenue: 0, totalOrders: 0, artists: [] },
      '<60': { count: 0, totalRevenue: 0, totalOrders: 0, artists: [] },
      'unknown': { count: 0, totalRevenue: 0, totalOrders: 0, artists: [] },
    }

    for (const b of allBenchmarks || []) {
      const totalRev = (b.tm_total_revenue || 0) + (b.axs_total_revenue || 0)
      const totalOrders = (b.tm_total_orders || 0) + (b.axs_total_orders || 0)
      if (totalOrders === 0) continue

      const cm = cmLookup[b.artist_name.toLowerCase()]
      const score = cm?.score

      let band = 'unknown'
      if (score !== null && score !== undefined) {
        if (score >= 90) band = '90+'
        else if (score >= 80) band = '80-89'
        else if (score >= 70) band = '70-79'
        else if (score >= 60) band = '60-69'
        else band = '<60'
      }

      bands[band].count++
      bands[band].totalRevenue += totalRev
      bands[band].totalOrders += totalOrders
      bands[band].artists.push(b.artist_name)
    }

    // Calculate averages per band
    const bandSummary: Record<string, { count: number; avgRevenue: number; avgOrders: number; medianRevenue: number }> = {}
    for (const [band, stats] of Object.entries(bands)) {
      if (stats.count === 0) continue
      bandSummary[band] = {
        count: stats.count,
        avgRevenue: Math.round(stats.totalRevenue / stats.count),
        avgOrders: Math.round(stats.totalOrders / stats.count),
        medianRevenue: 0, // Would need per-artist data to compute
      }
    }

    // Get artists that have both VIP and Shopify data (for VIP-to-Merch ratio)
    const { data: crossRef } = await supabase
      .from('merch_artist_benchmarks')
      .select('*')
      .not('shopify_monthly_revenue', 'is', null)

    const vipToMerchRatios = (crossRef || []).map(r => {
      const totalVipRev = (r.tm_total_revenue || 0) + (r.axs_total_revenue || 0)
      return {
        artist: r.artist_name,
        vipRevenue: totalVipRev,
        monthlyMerch: r.shopify_monthly_revenue,
        ratio: totalVipRev > 0 ? r.shopify_monthly_revenue / totalVipRev : 0,
      }
    })

    return NextResponse.json({
      artistBenchmark,
      bandSummary,
      vipToMerchRatios,
      totalArtistsWithData: (allBenchmarks || []).filter(b => (b.tm_total_orders || 0) + (b.axs_total_orders || 0) > 0).length,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
