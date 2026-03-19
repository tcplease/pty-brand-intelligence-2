import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const q = url.searchParams.get('q') || ''

  if (q.length < 2) {
    return NextResponse.json({ brands: [] })
  }

  try {
    const { data, error } = await supabase
      .from('intel_brand_affinities')
      .select('brand_name')
      .ilike('brand_name', `%${q}%`)
      .limit(100)

    if (error) throw error

    // Deduplicate and count occurrences
    const brandCounts = new Map<string, number>()
    for (const row of data || []) {
      const name = row.brand_name
      brandCounts.set(name, (brandCounts.get(name) || 0) + 1)
    }

    // Sort by how many artists have this brand
    const brands = Array.from(brandCounts.entries())
      .map(([name, count]) => ({ name, artist_count: count }))
      .sort((a, b) => b.artist_count - a.artist_count)
      .slice(0, 20)

    return NextResponse.json({ brands })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
