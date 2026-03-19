import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const chartmetricId = parseInt(id)

  try {
    const [
      { data: artist, error: artistError },
      { data: brands },
      { data: sectors },
      { data: deals },
      { data: contacts },
      { data: activity },
    ] = await Promise.all([
      supabase.from('intel_artists').select('*').eq('chartmetric_id', chartmetricId).single(),
      supabase.from('intel_brand_affinities').select('*').eq('chartmetric_id', chartmetricId).order('affinity_scale', { ascending: false }),
      supabase.from('intel_sector_affinities').select('*').eq('chartmetric_id', chartmetricId).order('affinity_scale', { ascending: false }),
      supabase.from('intel_monday_items').select('*').eq('chartmetric_id', chartmetricId).order('first_show', { ascending: true }),
      supabase.from('intel_artist_contacts').select('*').eq('chartmetric_id', chartmetricId).order('role', { ascending: true }),
      supabase.from('activity_log').select('*').eq('chartmetric_id', chartmetricId).order('created_at', { ascending: false }).limit(50),
    ])

    if (artistError) throw artistError

    return NextResponse.json({
      artist,
      brands: brands || [],
      sectors: sectors || [],
      deals: deals || [],
      contacts: contacts || [],
      activity: activity || [],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
