import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// --- Helper functions ---

function splitName(fullName: string | null): { firstName: string; lastName: string } {
  if (!fullName) return { firstName: '', lastName: '' }
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

function formatPhone(phone: string | null): string {
  if (!phone) return ''
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '')
  if (!cleaned.startsWith('+')) {
    cleaned = '+1' + cleaned
  }
  return cleaned
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function buildCSVRow(values: string[]): string {
  return values.map(escapeCSV).join(',')
}

// --- Platform formatters ---

type Platform = 'google_ads' | 'meta' | 'linkedin' | 'tiktok' | 'raw'

interface ContactRow {
  contact_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  linkedin_url: string | null
  role: string | null
  source: string | null
  artist_name: string | null
}

function formatGoogleAds(contacts: ContactRow[]): string {
  const header = 'Email,Phone,First Name,Last Name,Country,Zip'
  const rows = contacts
    .filter((c) => c.email)
    .map((c) => {
      const { firstName, lastName } = splitName(c.contact_name)
      const phone = formatPhone(c.phone)
      const country = c.country || 'US'
      const zip = c.zip || ''
      return buildCSVRow([c.email!, phone, firstName, lastName, country, zip])
    })
  return [header, ...rows].join('\n')
}

function formatMeta(contacts: ContactRow[]): string {
  const header = 'email,phone,fn,ln,ct,st,zip,country'
  const rows = contacts
    .filter((c) => c.email)
    .map((c) => {
      const { firstName, lastName } = splitName(c.contact_name)
      const phone = formatPhone(c.phone).replace(/^\+/, '')
      const city = (c.city || '').toLowerCase().replace(/\s+/g, '')
      const state = (c.state || '').toLowerCase()
      const zip = c.zip || ''
      const country = (c.country || 'US').toLowerCase()
      return buildCSVRow([
        c.email!.toLowerCase(),
        phone,
        firstName.toLowerCase(),
        lastName.toLowerCase(),
        city,
        state,
        zip.toLowerCase(),
        country,
      ])
    })
  return [header, ...rows].join('\n')
}

function formatLinkedIn(contacts: ContactRow[]): string {
  const header = 'email,firstName,lastName,companyName,jobTitle'
  const rows = contacts
    .filter((c) => c.email)
    .map((c) => {
      const { firstName, lastName } = splitName(c.contact_name)
      const company = c.company_name || ''
      const role = c.role || ''
      const jobTitle = role
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
      return buildCSVRow([c.email!, firstName, lastName, company, jobTitle])
    })
  return [header, ...rows].join('\n')
}

function formatTikTok(contacts: ContactRow[]): string {
  const header = 'email,email,email,phone,phone,phone,maid'
  const rows = contacts
    .filter((c) => c.email || c.phone)
    .map((c) => {
      const email = c.email || ''
      const phone = formatPhone(c.phone)
      return buildCSVRow([email, '', '', phone, '', '', ''])
    })
  return [header, ...rows].join('\n')
}

function formatRaw(contacts: ContactRow[]): string {
  const header =
    'artist_name,contact_name,role,company_name,email,phone,street,city,state,zip,country,linkedin_url,source'
  const rows = contacts.map((c) =>
    buildCSVRow([
      c.artist_name || '',
      c.contact_name || '',
      c.role || '',
      c.company_name || '',
      c.email || '',
      formatPhone(c.phone),
      c.street || '',
      c.city || '',
      c.state || '',
      c.zip || '',
      c.country || '',
      c.linkedin_url || '',
      c.source || '',
    ])
  )
  return [header, ...rows].join('\n')
}

const FORMATTERS: Record<Platform, (contacts: ContactRow[]) => string> = {
  google_ads: formatGoogleAds,
  meta: formatMeta,
  linkedin: formatLinkedIn,
  tiktok: formatTikTok,
  raw: formatRaw,
}

// --- Stats endpoint (no platform param) ---

async function getStats(): Promise<NextResponse> {
  try {
    const { data: contacts, error } = await supabase
      .from('intel_artist_contacts')
      .select('chartmetric_id, email')

    if (error) throw error

    const withEmail = (contacts || []).filter((c) => c.email)
    const uniqueArtists = new Set(withEmail.map((c) => c.chartmetric_id))

    return NextResponse.json({
      total_contacts: withEmail.length,
      total_artists: uniqueArtists.size,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// --- Main handler ---

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const platform = searchParams.get('platform') as Platform | null
  const stage = searchParams.get('stage')
  const role = searchParams.get('role')

  // Stats endpoint when no platform specified
  if (!platform) {
    return getStats()
  }

  if (!FORMATTERS[platform]) {
    return NextResponse.json(
      { error: `Invalid platform. Must be one of: ${Object.keys(FORMATTERS).join(', ')}` },
      { status: 400 }
    )
  }

  try {
    // Step 1: Get all monday items to build a stage map and identify "Lost" artists
    const { data: mondayItems, error: mondayError } = await supabase
      .from('intel_monday_items')
      .select('chartmetric_id, stage')
      .not('chartmetric_id', 'is', null)

    if (mondayError) throw mondayError

    // Build a map of chartmetric_id → latest stage
    // An artist may have multiple monday items; use the "best" (most advanced) stage
    const stageMap = new Map<number, string>()
    const lostArtists = new Set<number>()

    for (const item of mondayItems || []) {
      if (!item.chartmetric_id) continue
      const currentStage = item.stage || ''
      if (currentStage === 'Lost') {
        // Only mark as lost if ALL their items are lost
        if (!stageMap.has(item.chartmetric_id)) {
          lostArtists.add(item.chartmetric_id)
        }
      } else {
        lostArtists.delete(item.chartmetric_id)
        stageMap.set(item.chartmetric_id, currentStage)
      }
    }

    // Step 2: Query contacts and artists in parallel
    let contactQuery = supabase
      .from('intel_artist_contacts')
      .select(
        'contact_name, company_name, email, phone, street, city, state, zip, country, linkedin_url, role, source, chartmetric_id'
      )
      .order('contact_name', { ascending: true })

    if (role) {
      contactQuery = contactQuery.eq('role', role)
    }

    const [{ data: contacts, error: contactsError }, { data: artists, error: artistsError }] =
      await Promise.all([
        contactQuery,
        supabase.from('intel_artists').select('chartmetric_id, name'),
      ])

    if (contactsError) throw contactsError
    if (artistsError) throw artistsError

    // Build artist name lookup
    const artistNames = new Map<number, string>()
    for (const a of artists || []) {
      artistNames.set(a.chartmetric_id, a.name)
    }

    // Step 3: Filter out Lost artists and apply stage filter
    const filtered = (contacts || [])
      .filter((c) => {
        // Exclude contacts whose artist's only stage is Lost
        if (lostArtists.has(c.chartmetric_id)) return false

        // Apply stage filter if specified
        if (stage) {
          const artistStage = stageMap.get(c.chartmetric_id)
          if (!artistStage) return false
          if (artistStage !== stage) return false
        }

        return true
      })
      .map((c) => ({
        contact_name: c.contact_name,
        company_name: c.company_name,
        email: c.email,
        phone: c.phone,
        street: c.street,
        city: c.city,
        state: c.state,
        zip: c.zip,
        country: c.country,
        linkedin_url: c.linkedin_url,
        role: c.role,
        source: c.source,
        artist_name: artistNames.get(c.chartmetric_id) || null,
      }))

    // Step 4: Format CSV
    const csvContent = FORMATTERS[platform](filtered)
    const date = new Date().toISOString().split('T')[0]

    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="pty_contacts_${platform}_${date}.csv"`,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
