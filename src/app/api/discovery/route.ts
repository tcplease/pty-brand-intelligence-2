import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const period = url.searchParams.get('period') || 'week'
    const includeAll = url.searchParams.get('all') === 'true'

    // Get discovery artists (not in pipeline, not dismissed)
    const { data: artists, error: artistError } = await supabase
      .from('intel_artists')
      .select('*')
      .eq('discovery_status', 'new')
      .in('source', ['festival_signal', 'manual'])
      .order('created_at', { ascending: false })

    if (artistError) throw artistError
    if (!artists || artists.length === 0) {
      return NextResponse.json({ artists: [], total: 0, newThisWeek: 0 })
    }

    const cmIds = artists.map(a => a.chartmetric_id)
    console.log('Discovery API — cmIds count:', cmIds.length, 'first 5:', cmIds.slice(0, 5))

    // Fetch festival appearances in batches of 30 to avoid .in() limits
    let allFestivals: any[] = []
    for (let i = 0; i < cmIds.length; i += 30) {
      const batch = cmIds.slice(i, i + 30)
      const { data: festData } = await supabase
        .from('festival_appearances')
        .select('*')
        .in('chartmetric_id', batch)

      if (festData) allFestivals.push(...festData)
        console.log('  Festival batch:', batch.length, 'ids, returned:', festData?.length ?? 0)
    }

    // Fetch activity in batches too
    let allActivity: any[] = []
    for (let i = 0; i < cmIds.length; i += 30) {
      const batch = cmIds.slice(i, i + 30)
      const { data: actData } = await supabase
        .from('activity_log')
        .select('*')
        .in('chartmetric_id', batch)
        .order('created_at', { ascending: false })

      if (actData) allActivity.push(...actData)
    }

    // Build maps
    const festivalsByArtist: Record<number, any[]> = {}
    for (const f of allFestivals) {
      if (!festivalsByArtist[f.chartmetric_id]) festivalsByArtist[f.chartmetric_id] = []
      festivalsByArtist[f.chartmetric_id].push(f)
    }

    const activityByArtist: Record<number, any[]> = {}
    for (const a of allActivity) {
      if (!activityByArtist[a.chartmetric_id]) activityByArtist[a.chartmetric_id] = []
      activityByArtist[a.chartmetric_id].push(a)
    }

    // Filter by time period
    const now = new Date()
    const cutoff = new Date()
    if (period === 'week') {
      cutoff.setDate(now.getDate() - 7)
    } else {
      cutoff.setMonth(now.getMonth() - 1)
    }

    const filtered = includeAll
      ? artists
      : artists.filter(a => new Date(a.created_at) >= cutoff)

    // Enrich with festivals, activity, and presave signals
    const enriched = filtered.map(a => {
      const activity = activityByArtist[a.chartmetric_id] || []
      const presaves = activity.filter((e: any) => e.event_type === 'album_presave')
      return {
        ...a,
        festivals: festivalsByArtist[a.chartmetric_id] || [],
        festival_count: (festivalsByArtist[a.chartmetric_id] || []).length,
        activity: activity.slice(0, 5),
        presaves,
        presave_count: presaves.length,
        signal_type: presaves.length > 0 && (festivalsByArtist[a.chartmetric_id] || []).length > 0
          ? 'both'
          : presaves.length > 0 ? 'presave' : 'festival',
      }
    })

    enriched.sort((a, b) => {
      if (b.festival_count !== a.festival_count) return b.festival_count - a.festival_count
      return (b.cm_score || 0) - (a.cm_score || 0)
    })

    // Count for roster banner
    const weekAgo = new Date()
    weekAgo.setDate(now.getDate() - 7)
    const newThisWeek = artists.filter(a => new Date(a.created_at) >= weekAgo).length

    return NextResponse.json({
      artists: enriched,
      total: enriched.length,
      newThisWeek,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { chartmetric_id, action } = body

    if (!chartmetric_id || !action) {
      return NextResponse.json({ error: 'chartmetric_id and action required' }, { status: 400 })
    }

    if (action === 'dismiss') {
      const { error } = await supabase
        .from('intel_artists')
        .update({
          discovery_status: 'dismissed',
          dismissed_at: new Date().toISOString(),
        })
        .eq('chartmetric_id', chartmetric_id)

      if (error) throw error

      await supabase.from('activity_log').insert({
        chartmetric_id,
        event_type: 'stage_change',
        event_title: 'Dismissed from discovery feed',
        event_detail: { action: 'dismissed' },
        event_date: new Date().toISOString().split('T')[0],
      })
    }

    if (action === 'promote') {
      const { error } = await supabase
        .from('intel_artists')
        .update({ discovery_status: 'pipeline' })
        .eq('chartmetric_id', chartmetric_id)

      if (error) throw error

      await supabase.from('activity_log').insert({
        chartmetric_id,
        event_type: 'stage_change',
        event_title: 'Promoted to pipeline from discovery',
        event_detail: { action: 'promoted' },
        event_date: new Date().toISOString().split('T')[0],
      })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}