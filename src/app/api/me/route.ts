import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  try {
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll() {
            // Read-only for this route
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Look up app_users for role and Monday mapping
    const { data: appUser } = await supabase
      .from('app_users')
      .select('name, role, monday_person_name')
      .eq('email', user.email)
      .single()

    return NextResponse.json({
      email: user.email,
      name: appUser?.name ?? user.user_metadata?.full_name ?? user.email.split('@')[0],
      role: appUser?.role ?? 'viewer',
      monday_person_name: appUser?.monday_person_name ?? null,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('GET /api/me failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
