import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const chartmetricId = parseInt(params.id)

  try {
    // Get artist details
    const { data: artist, error: artistError } = await supabase
      .from('intel_artists')
      .select('*')
      .eq('chartmetric_id', chartmetricId)
      .single()

    if (artistError) throw artistError

    // Get brand affinities
    const { data: brands, error: brandsError } = await supabase
      .from('intel_brand_affinities')
      .select('*')
      .eq('chartmetric_id', chartmetricId)
      .order('affinity_scale', { ascending: false })

    if (brandsError) throw brandsError

    // Get sector affinities
    const { data: sectors, error: sectorsError } = await supabase
      .from('intel_sector_affinities')
      .select('*')
      .eq('chartmetric_id', chartmetricId)
      .order('affinity_scale', { ascending: false })

    if (sectorsError) throw sectorsError

    // Get Monday deal info
    const { data: deals, error: dealsError } = await supabase
      .from('intel_monday_items')
      .select('*')
      .eq('chartmetric_id', chartmetricId)
      .order('close_probability', { ascending: false })

    if (dealsError) throw dealsError

    return NextResponse.json({
      artist,
      brands: brands || [],
      sectors: sectors || [],
      deals: deals || [],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
