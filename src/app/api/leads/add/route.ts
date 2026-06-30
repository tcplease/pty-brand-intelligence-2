import { NextResponse } from 'next/server'
import { supabase, createServiceClient } from '@/lib/supabase'
import { resolveAndEnrichArtist } from '@/lib/resolve-artist'
import { getCMToken } from '@/lib/chartmetric-enrich'

export const maxDuration = 300

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// Paginated roster fetch for reuse-before-pay (intel_artists exceeds the 1000-row cap).
async function fetchAllArtists(client: ReturnType<typeof createServiceClient>) {
  const PAGE = 1000
  let from = 0
  const out: { chartmetric_id: number; name: string; followers: number | null }[] = []
  while (true) {
    const { data, error } = await client
      .from('intel_artists')
      .select('chartmetric_id, name, spotify_followers, instagram_followers')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    type Row = { chartmetric_id: number; name: string; spotify_followers: number | null; instagram_followers: number | null }
    for (const r of (data as Row[]) ?? []) {
      out.push({ chartmetric_id: r.chartmetric_id, name: r.name, followers: Math.max(r.spotify_followers ?? 0, r.instagram_followers ?? 0) || null })
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

interface ParsedLead {
  name: string
  tourInfo: string
}

function parseLeadText(text: string): ParsedLead[] {
  const leads: ParsedLead[] = []
  // Keep original whitespace — don't trim lines yet
  const lines = text.split('\n').filter(l => l.trim().length > 0)

  let currentName: string | null = null
  let currentTourLines: string[] = []

  for (const rawLine of lines) {
    // Count leading whitespace to detect indentation
    const indent = rawLine.search(/\S/)
    const cleaned = rawLine.trim().replace(/^[\*\-•]+\s*/, '').trim()

    if (!cleaned) continue

    // Sub-item: indented (3+ spaces) or starts with whitespace before bullet
    const isIndented = indent >= 3 || (indent >= 1 && /^[\*\-•]/.test(rawLine.trim()) && currentName)

    // Check if this looks like tour info (dates, seasons, announcing, etc.)
    const looksLikeTourInfo = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|spring|summer|fall|winter|q[1-4]|20\d{2}|announcing|tbd|release|headline|support|dates?|amps?|arenas?|theaters?|amphitheaters?)\b/i.test(cleaned) ||
      /^\d{2,4}[-\/]/.test(cleaned)

    if (isIndented || (currentName && looksLikeTourInfo)) {
      // Tour info line
      currentTourLines.push(cleaned)
    } else {
      // New artist name
      if (currentName) {
        leads.push({ name: currentName, tourInfo: currentTourLines.join(' | ') })
      }
      currentName = cleaned
      currentTourLines = []
    }
  }

  // Save last artist
  if (currentName) {
    leads.push({ name: currentName, tourInfo: currentTourLines.join(' | ') })
  }

  // Deduplicate by name (keep last occurrence which may have more tour info)
  const seen = new Map<string, ParsedLead>()
  for (const lead of leads) {
    const key = lead.name.toLowerCase()
    const existing = seen.get(key)
    if (existing) {
      // Merge tour info
      const combined = [existing.tourInfo, lead.tourInfo].filter(Boolean).join(' | ')
      seen.set(key, { name: lead.name, tourInfo: combined })
    } else {
      seen.set(key, lead)
    }
  }

  return Array.from(seen.values())
}

// Step 1: Parse only (for preview)
async function handleParse(body: { text: string }) {
  const leads = parseLeadText(body.text)

  // Check which already exist in our DB
  const names = leads.map(l => l.name)
  const { data: existing } = await supabase
    .from('intel_artists')
    .select('name, chartmetric_id, cm_score, career_stage, discovery_status')

  const existingMap = new Map<string, { chartmetric_id: number; cm_score: number | null; career_stage: string | null; discovery_status: string | null }>()
  for (const a of existing || []) {
    existingMap.set(a.name.toLowerCase(), a)
  }

  const parsed = leads.map(l => {
    const match = existingMap.get(l.name.toLowerCase())
    return {
      name: l.name,
      tourInfo: l.tourInfo,
      existsInDb: !!match,
      discoveryStatus: match?.discovery_status || null,
      cmScore: match?.cm_score || null,
      careerStage: match?.career_stage || null,
    }
  })

  return NextResponse.json({ parsed, total: parsed.length, existing: parsed.filter(p => p.existsInDb).length })
}

// Step 2: Confirm and import — routes every lead through the shared resolver
// (reuse-before-pay → CM tiebreak → INSERT + full enrichment). Radar leads persist
// to intel_artists even if never promoted to the pipeline (discovery_status='new'),
// so they're reused later with zero re-pull. Writes go through service_role and
// errors are surfaced (never report a created lead that didn't persist).
async function handleImport(body: { leads: ParsedLead[]; source: string; submittedBy: string }) {
  const { leads, source, submittedBy } = body
  const serviceClient = createServiceClient()

  let token: string
  try {
    token = await getCMToken()
  } catch {
    return NextResponse.json({ error: 'CM token failed' }, { status: 500 })
  }

  const roster = await fetchAllArtists(serviceClient)
  const deps = {
    client: serviceClient,
    getToken: async () => token,
    existing: roster,
    source: 'manual', // keeps Radar leads in the discovery feed (source.in.(festival_signal,manual))
    discoveryStatus: 'new',
  }

  // (needs-review is handled in the per-lead loop below — surfaced, never auto-created)

  const results: Array<{ name: string; status: string; chartmetric_id?: number; note?: string; error?: string }> = []

  for (const lead of leads) {
    await sleep(400)
    const r = await resolveAndEnrichArtist(lead.name, deps)

    if (r.outcome === 'error') {
      results.push({ name: lead.name, status: 'error', error: r.error })
      continue
    }
    if (r.outcome === 'needs-review') {
      // Low-confidence — surface for manual review, do not auto-create/link.
      results.push({ name: lead.name, status: 'needs_review', note: (r.reasons ?? []).join(', ') })
      continue
    }
    if (r.outcome === 'no-match' || r.chartmetric_id == null) {
      results.push({ name: lead.name, status: 'not_found' })
      continue
    }

    // Log the lead submission against the resolved artist (existing or newly pulled).
    await serviceClient.from('activity_log').insert({
      chartmetric_id: r.chartmetric_id,
      event_type: 'added_to_pipeline',
      event_title: `Tour lead submitted by ${submittedBy} via ${source}`,
      event_detail: { tour_info: lead.tourInfo, source },
      event_date: new Date().toISOString().split('T')[0],
    })

    results.push({
      name: lead.name,
      status: r.rowCreated ? 'created' : 'exists',
      chartmetric_id: r.chartmetric_id,
      ...(r.note ? { note: r.note } : {}),
    })
  }

  return NextResponse.json({
    success: true,
    total: results.length,
    created: results.filter(r => r.status === 'created').length,
    existing: results.filter(r => r.status === 'exists').length,
    needsReview: results.filter(r => r.status === 'needs_review').length,
    notFound: results.filter(r => r.status === 'not_found').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (body.action === 'parse') {
      return handleParse(body)
    } else if (body.action === 'import') {
      return handleImport(body)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    console.error('Lead add error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
