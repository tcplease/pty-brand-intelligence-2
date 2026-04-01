import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function createAuthClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() { /* read-only */ },
      },
    }
  )
}

// GET — list saved pitches for an artist
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const chartmetricId = url.searchParams.get('chartmetric_id')

    if (!chartmetricId) {
      return NextResponse.json({ error: 'chartmetric_id required' }, { status: 400 })
    }

    const supabase = await createAuthClient()

    const { data, error } = await supabase
      .from('saved_pitches')
      .select('id, chartmetric_id, created_by_email, created_by_name, pitch_text, pitch_prompt, created_at')
      .eq('chartmetric_id', parseInt(chartmetricId))
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ pitches: data || [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST — save a new pitch
export async function POST(request: Request) {
  try {
    const supabase = await createAuthClient()

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get display name from app_users
    const { data: appUser } = await supabase
      .from('app_users')
      .select('name')
      .eq('email', user.email)
      .single()

    const displayName = appUser?.name ?? user.user_metadata?.full_name ?? user.email.split('@')[0]

    const body = await request.json()
    const { chartmetric_id, pitch_text, pitch_prompt } = body

    if (!chartmetric_id || !pitch_text) {
      return NextResponse.json({ error: 'chartmetric_id and pitch_text required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('saved_pitches')
      .insert({
        chartmetric_id,
        created_by_email: user.email,
        created_by_name: displayName,
        pitch_text,
        pitch_prompt: pitch_prompt || null,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ pitch: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE — remove a saved pitch (creator only)
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const pitchId = url.searchParams.get('id')

    if (!pitchId) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    const supabase = await createAuthClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Verify ownership before deleting
    const { data: pitch } = await supabase
      .from('saved_pitches')
      .select('created_by_email')
      .eq('id', pitchId)
      .single()

    if (!pitch) {
      return NextResponse.json({ error: 'Pitch not found' }, { status: 404 })
    }

    if (pitch.created_by_email !== user.email) {
      return NextResponse.json({ error: 'Can only delete your own pitches' }, { status: 403 })
    }

    const { error } = await supabase
      .from('saved_pitches')
      .delete()
      .eq('id', pitchId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
