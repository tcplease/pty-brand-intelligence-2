import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Distinct sectors for the Match page multi-select. The IDENTITY is sector_name —
// sector_id is a per-artist rank index (0,1,2… = that artist's #1/#2/#3 sector), so
// the same sector_name spans many sector_ids and sector_id is meaningless as a key.
// The list is small (~28) and stable, so cache aggressively.
export async function GET() {
  try {
    const set = new Set<string>()
    const PAGE = 1000
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('intel_sector_affinities')
        .select('sector_name')
        .range(from, from + PAGE - 1)
      if (error) throw error
      for (const r of data || []) {
        if (r.sector_name) set.add(r.sector_name)
      }
      if (!data || data.length < PAGE) break
      from += PAGE
    }
    const sectors = Array.from(set).sort((a, b) => a.localeCompare(b))
    return NextResponse.json(
      { sectors, count: sectors.length },
      { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } },
    )
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}
