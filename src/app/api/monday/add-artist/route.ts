import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// DRY RUN MODE — set to false when ready to write to Monday
const DRY_RUN = false

const MONDAY_TOKEN = process.env.MONDAY_API_TOKEN || ''
const BOARD_ID = '2696356409' // Events Deals board

interface AddArtistRequest {
  chartmetric_id: number
}

async function getAuthUser() {
  const cookieStore = await cookies()
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await sb.auth.getUser()
  return user
}

export async function POST(request: Request) {
  try {
    // 1. Authenticate user
    const authUser = await getAuthUser()
    if (!authUser?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get app_users record for Monday mapping
    const { data: appUser } = await supabase
      .from('app_users')
      .select('name, monday_person_id, monday_person_name')
      .eq('email', authUser.email)
      .single()

    if (!appUser) {
      return NextResponse.json({ error: 'User not found in app_users' }, { status: 403 })
    }

    // 2. Parse request
    const body: AddArtistRequest = await request.json()
    const { chartmetric_id } = body

    if (!chartmetric_id) {
      return NextResponse.json({ error: 'chartmetric_id is required' }, { status: 400 })
    }

    // 3. Get artist info
    const { data: artist } = await supabase
      .from('intel_artists')
      .select('name, chartmetric_id, career_stage, primary_genre')
      .eq('chartmetric_id', chartmetric_id)
      .single()

    if (!artist) {
      return NextResponse.json({ error: 'Artist not found' }, { status: 404 })
    }

    // 4. Check for existing ACTIVE Monday deal
    const today = new Date().toISOString().split('T')[0]
    const HIDDEN_STAGES = ['Lost', 'Tour Canceled', 'Fell Off (Not Lost)']

    const { data: existingDeals } = await supabase
      .from('intel_monday_items')
      .select('monday_item_id, stage, last_show')
      .eq('chartmetric_id', chartmetric_id)

    const activeDeal = (existingDeals || []).find(d => {
      if (!d.stage || HIDDEN_STAGES.includes(d.stage)) return false
      if (d.last_show && d.last_show < today) return false
      return true
    })

    if (activeDeal) {
      return NextResponse.json({
        error: 'Artist already has an active deal',
        deal_stage: activeDeal.stage,
      }, { status: 409 })
    }

    // 5. Create Monday item (or dry-run)
    let mondayItemId: string | null = null

    if (DRY_RUN) {
      // Simulate Monday write
      mondayItemId = `dry-run-${Date.now()}`
      console.log('[DRY RUN] Would create Monday item:', {
        board: BOARD_ID,
        artist: artist.name,
        stage: 'Outbound - No Contact',
        sales_lead: appUser.monday_person_name,
        priority: 'Medium',
      })
    } else {
      // Real Monday write
      const columnValues = JSON.stringify({
        status: { label: 'Outbound - No Contact' },
        priority: { label: 'Medium' },
        ...(appUser.monday_person_id ? {
          person: { personsAndTeams: [{ id: appUser.monday_person_id, kind: 'person' }] }
        } : {}),
      })

      const mutation = `mutation {
        create_item(
          board_id: ${BOARD_ID},
          item_name: "${artist.name.replace(/"/g, '\\"')}",
          column_values: ${JSON.stringify(columnValues)}
        ) { id }
      }`

      const mondayRes = await fetch('https://api.monday.com/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MONDAY_TOKEN}`,
        },
        body: JSON.stringify({ query: mutation }),
      })

      const mondayData = await mondayRes.json()
      if (mondayData.errors) {
        console.error('Monday write failed:', mondayData.errors)
        return NextResponse.json({
          error: 'Failed to create Monday item',
          details: mondayData.errors[0]?.message,
        }, { status: 502 })
      }

      mondayItemId = mondayData.data?.create_item?.id
    }

    // 6. Update our database — only after confirmed Monday success
    // Insert Monday item record
    await supabase.from('intel_monday_items').insert({
      monday_item_id: mondayItemId ? parseInt(mondayItemId) : Date.now(),
      artist_name: artist.name,
      chartmetric_id: chartmetric_id,
      stage: 'Outbound - No Contact',
      sales_lead: appUser.monday_person_name || appUser.name,
      priority: 'Medium',
    })

    // Update artist to pipeline status
    await supabase
      .from('intel_artists')
      .update({
        discovery_status: 'pipeline',
        source: 'both',
        updated_at: new Date().toISOString(),
      })
      .eq('chartmetric_id', chartmetric_id)

    // Log activity
    await supabase.from('activity_log').insert({
      chartmetric_id: chartmetric_id,
      event_type: 'added_to_pipeline',
      event_title: `Added to Pipeline by ${appUser.name}`,
      event_detail: {
        added_by: appUser.name,
        added_by_email: authUser.email,
        stage: 'Outbound - No Contact',
        dry_run: DRY_RUN,
      },
      event_date: new Date().toISOString().split('T')[0],
    })

    return NextResponse.json({
      success: true,
      dry_run: DRY_RUN,
      artist: artist.name,
      monday_item_id: mondayItemId,
      stage: 'Outbound - No Contact',
      added_by: appUser.name,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Add to Monday failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
