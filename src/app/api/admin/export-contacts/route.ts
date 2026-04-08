import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

// --- Sanitization ---

/** Strip characters that could trigger CSV injection or break parsing */
function sanitize(value: string | null | undefined): string {
  if (!value) return ''
  let v = value.trim()
  // Strip quotation marks (curly quotes, straight quotes, backticks)
  v = v.replace(/["""''`]/g, '')
  // Strip CSV injection triggers: cells starting with =, +, -, @, tab, CR
  v = v.replace(/^[=+\-@\t\r]+/, '')
  // Strip non-printable control characters (keep newline for address fields, but replace)
  v = v.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '')
  // Collapse multiple whitespace
  v = v.replace(/\s+/g, ' ').trim()
  return v
}

/** Validate email format loosely — reject obviously broken values */
function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/** Validate phone — at least 7 digits after stripping formatting */
function isPlausiblePhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

// --- Name splitting ---

function splitName(fullName: string | null): { firstName: string; lastName: string } {
  if (!fullName) return { firstName: '', lastName: '' }

  let name = sanitize(fullName)

  // Remove parenthetical nicknames: "Robert (Bobby) Smith" → "Robert Smith"
  name = name.replace(/\(.*?\)/g, '').trim()
  // Remove quoted nicknames: "Robert Bobby Smith" (already stripped quotes above)

  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  if (parts.length === 2) return { firstName: parts[0], lastName: parts[1] }

  // 3+ parts — ambiguous (could be "Mary Jo Smith" or "John van der Berg")
  // Conservative: first word is first name, leave lastName blank to avoid errors
  return { firstName: parts[0], lastName: '' }
}

// --- Phone formatting ---

function formatPhone(phone: string | null): string {
  if (!phone) return ''
  const cleaned = sanitize(phone).replace(/[\s\-\(\)\.]/g, '')
  if (!cleaned) return ''
  let normalized = cleaned
  if (!normalized.startsWith('+')) {
    normalized = '+1' + normalized
  }
  if (!isPlausiblePhone(normalized)) return ''
  return normalized
}

// --- CSV helpers ---

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function buildCSVRow(values: string[]): string {
  return values.map((v) => escapeCSV(sanitize(v) || v)).join(',')
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

interface VerifyResult {
  valid: ContactRow[]
  skipped: number
  reasons: Record<string, number>
}

/** Verify and clean all contacts, tracking skip reasons */
function verifyContacts(contacts: ContactRow[], requireEmail: boolean): VerifyResult {
  const valid: ContactRow[] = []
  let skipped = 0
  const reasons: Record<string, number> = {}

  function skip(reason: string) {
    skipped++
    reasons[reason] = (reasons[reason] || 0) + 1
  }

  for (const c of contacts) {
    const email = c.email ? sanitize(c.email).toLowerCase() : ''
    const phone = formatPhone(c.phone)

    if (requireEmail && (!email || !isPlausibleEmail(email))) {
      skip('invalid_or_missing_email')
      continue
    }
    if (!requireEmail && !email && !phone) {
      skip('no_email_or_phone')
      continue
    }

    valid.push({
      ...c,
      email: email || null,
      phone: phone || null,
      contact_name: sanitize(c.contact_name),
      company_name: sanitize(c.company_name),
      street: sanitize(c.street),
      city: sanitize(c.city),
      state: sanitize(c.state),
      zip: sanitize(c.zip),
      country: sanitize(c.country),
      linkedin_url: sanitize(c.linkedin_url),
      role: sanitize(c.role),
      source: sanitize(c.source),
      artist_name: sanitize(c.artist_name),
    })
  }

  return { valid, skipped, reasons }
}

function formatGoogleAds(contacts: ContactRow[]): string {
  const { valid } = verifyContacts(contacts, true)
  const header = 'Email,Phone,First Name,Last Name,Country,Zip'
  const rows = valid.map((c) => {
    const { firstName, lastName } = splitName(c.contact_name)
    return buildCSVRow([c.email!, c.phone || '', firstName, lastName, c.country || 'US', c.zip || ''])
  })
  return [header, ...rows].join('\n')
}

function formatMeta(contacts: ContactRow[]): string {
  const { valid } = verifyContacts(contacts, true)
  const header = 'email,phone,fn,ln,ct,st,zip,country'
  const rows = valid.map((c) => {
    const { firstName, lastName } = splitName(c.contact_name)
    const phone = (c.phone || '').replace(/^\+/, '')
    const city = (c.city || '').toLowerCase().replace(/\s+/g, '')
    return buildCSVRow([
      c.email!.toLowerCase(),
      phone,
      firstName.toLowerCase(),
      lastName.toLowerCase(),
      city,
      (c.state || '').toLowerCase(),
      (c.zip || '').toLowerCase(),
      (c.country || 'US').toLowerCase(),
    ])
  })
  return [header, ...rows].join('\n')
}

function formatLinkedIn(contacts: ContactRow[]): string {
  const { valid } = verifyContacts(contacts, true)
  const header = 'email,firstName,lastName,companyName,jobTitle'
  const rows = valid.map((c) => {
    const { firstName, lastName } = splitName(c.contact_name)
    const role = c.role || ''
    const jobTitle = role
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    return buildCSVRow([c.email!, firstName, lastName, c.company_name || '', jobTitle])
  })
  return [header, ...rows].join('\n')
}

function formatTikTok(contacts: ContactRow[]): string {
  const { valid } = verifyContacts(contacts, false)
  const header = 'email,email,email,phone,phone,phone,maid'
  const rows = valid.map((c) =>
    buildCSVRow([c.email || '', '', '', c.phone || '', '', '', ''])
  )
  return [header, ...rows].join('\n')
}

function formatRaw(contacts: ContactRow[]): string {
  // Raw includes everything — no email requirement, no verification filtering
  const header = 'contact_name,role,company_name,email,phone,source'
  const rows = contacts.map((c) =>
    buildCSVRow([
      sanitize(c.contact_name),
      sanitize(c.role),
      sanitize(c.company_name),
      sanitize(c.email),
      formatPhone(c.phone),
      sanitize(c.source),
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

// --- Stats endpoint ---

async function getStats(): Promise<NextResponse> {
  try {
    const serviceClient = createServiceClient()
    const [{ count, error }, { data: latest }] = await Promise.all([
      serviceClient
        .from('export_contacts')
        .select('*', { count: 'exact', head: true }),
      serviceClient
        .from('export_contacts')
        .select('synced_at')
        .order('synced_at', { ascending: false })
        .limit(1),
    ])

    if (error) throw error

    return NextResponse.json({
      total_contacts: count ?? 0,
      last_synced: latest?.[0]?.synced_at ?? null,
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
    // Query all contacts from export table
    const serviceClient = createServiceClient()
    const { data: contacts, error: contactsError } = await serviceClient
      .from('export_contacts')
      .select('contact_name, company_name, email, phone, role, source')
      .order('contact_name', { ascending: true })

    if (contactsError) throw contactsError

    const rows: ContactRow[] = (contacts || []).map((c) => ({
      contact_name: c.contact_name,
      company_name: c.company_name,
      email: c.email,
      phone: c.phone,
      street: null,
      city: null,
      state: null,
      zip: null,
      country: null,
      linkedin_url: null,
      role: c.role,
      source: c.source,
      artist_name: null,
    }))

    // Format CSV
    const csvContent = FORMATTERS[platform](rows)
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
