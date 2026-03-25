import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const CM_REFRESH_TOKEN = process.env.CHARTMETRIC_TOKEN!
const CM_BASE = 'https://api.chartmetric.com/api'

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function getCMToken(): Promise<string> {
  const res = await fetch(`${CM_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshtoken: CM_REFRESH_TOKEN }),
  })
  const data = await res.json()
  if (!data.token) throw new Error('Failed to get CM token')
  return data.token
}

interface ParsedLead {
  name: string
  tourInfo: string
}

function parseLeadText(text: string): ParsedLead[] {
  const leads: ParsedLead[] = []
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  let currentName: string | null = null
  let currentTourLines: string[] = []

  for (const line of lines) {
    // Detect artist name lines: starts with *, bullet, dash+space followed by ALL CAPS or mixed case
    // Or a line that doesn't start with whitespace/indent markers and isn't a sub-bullet
    const isBullet = /^[\*\-•]\s+/.test(line)
    const isSubBullet = /^\s+[\*\-•]\s+/.test(line) || /^\s{2,}/.test(line)
    const cleanLine = line.replace(/^[\*\-•]\s+/, '').trim()

    if (!cleanLine) continue

    if (isBullet && !isSubBullet) {
      // Save previous artist
      if (currentName) {
        leads.push({ name: currentName, tourInfo: currentTourLines.join(' | ') })
      }
      currentName = cleanLine
      currentTourLines = []
    } else if (isSubBullet || (currentName && !isBullet)) {
      // Tour info line
      const tourLine = cleanLine.replace(/^[\*\-•]\s+/, '').trim()
      if (tourLine) currentTourLines.push(tourLine)
    } else {
      // Standalone line — treat as artist name
      if (currentName) {
        leads.push({ name: currentName, tourInfo: currentTourLines.join(' | ') })
      }
      currentName = cleanLine
      currentTourLines = []
    }
  }

  // Save last artist
  if (currentName) {
    leads.push({ name: currentName, tourInfo: currentTourLines.join(' | ') })
  }

  // Filter out lines that look like tour info but got parsed as names
  return leads.filter(l => {
    const lower = l.name.toLowerCase()
    // Skip lines that are clearly tour dates, not artist names
    if (/^\d{2,4}[-\/]/.test(l.name)) return false
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s/i.test(l.name)) return false
    if (lower.startsWith('announcing') || lower.startsWith('release') || lower.startsWith('tbd')) return false
    return true
  })
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

// Step 2: Confirm and import
async function handleImport(body: { leads: ParsedLead[]; source: string; submittedBy: string }) {
  const { leads, source, submittedBy } = body
  const token = await getCMToken()

  const results: Array<{ name: string; status: string; chartmetric_id?: number }> = []

  for (const lead of leads) {
    // Check if already in DB
    const { data: existing } = await supabase
      .from('intel_artists')
      .select('chartmetric_id')
      .ilike('name', lead.name)
      .limit(1)

    if (existing && existing.length > 0) {
      // Already exists — just log the activity
      const cmId = existing[0].chartmetric_id
      await supabase.from('activity_log').insert({
        chartmetric_id: cmId,
        event_type: 'added_to_pipeline',
        event_title: `Tour lead submitted by ${submittedBy} via ${source}`,
        event_detail: { tour_info: lead.tourInfo, source },
        event_date: new Date().toISOString().split('T')[0],
      })
      results.push({ name: lead.name, status: 'exists', chartmetric_id: cmId })
      continue
    }

    // Search Chartmetric
    await sleep(500)
    let cmId: number | null = null
    let profile: Record<string, unknown> = {}

    try {
      const searchRes = await fetch(`${CM_BASE}/search?q=${encodeURIComponent(lead.name)}&type=artists&limit=3`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const searchData = await searchRes.json()
      const matches = searchData?.obj?.artists || []
      const match = matches.find((a: any) => a.name?.toLowerCase() === lead.name.toLowerCase()) ||
                    matches.find((a: any) => a.name?.toLowerCase().includes(lead.name.toLowerCase()) || lead.name.toLowerCase().includes(a.name?.toLowerCase()))

      if (!match) {
        results.push({ name: lead.name, status: 'not_found' })
        continue
      }

      cmId = match.id as number
    } catch {
      results.push({ name: lead.name, status: 'error' })
      continue
    }

    // Full CM enrichment — profile
    await sleep(500)
    try {
      const profRes = await fetch(`${CM_BASE}/artist/${cmId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (profRes.ok) profile = (await profRes.json())?.obj || {}
    } catch { /* use empty */ }

    // Career stage
    await sleep(500)
    let careerStage: string | null = null
    try {
      const careerRes = await fetch(`${CM_BASE}/artist/${cmId}/career?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (careerRes.ok) careerStage = ((await careerRes.json())?.obj?.[0])?.stage || null
    } catch { /* skip */ }

    // Spotify ID
    await sleep(500)
    let spotifyId: string | null = null
    try {
      const urlsRes = await fetch(`${CM_BASE}/artist/${cmId}/urls`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (urlsRes.ok) {
        const urls = (await urlsRes.json())?.obj || []
        const spEntry = urls.find((u: any) => u.domain === 'spotify')
        if (spEntry?.url?.[0]) {
          const spMatch = spEntry.url[0].match(/artist\/([a-zA-Z0-9]+)/)
          if (spMatch) spotifyId = spMatch[1]
        }
      }
    } catch { /* skip */ }

    // Insert artist
    const p = profile as any
    const { error } = await supabase.from('intel_artists').insert({
      chartmetric_id: cmId,
      name: p.name || lead.name,
      image_url: p.image_url || null,
      cm_score: p.cm_artist_score || null,
      career_stage: careerStage,
      primary_genre: p.artist_genres?.[0]?.name || null,
      spotify_followers: p.sp_followers || null,
      spotify_monthly_listeners: p.sp_monthly_listeners || null,
      instagram_followers: p.ins_followers || null,
      youtube_subscribers: p.ycs_subscribers || null,
      tiktok_followers: p.tiktok_followers || null,
      audience_male_pct: p.sp_fans_male_pct || null,
      audience_female_pct: p.sp_fans_female_pct || null,
      spotify_artist_id: spotifyId,
      source: 'manual',
      discovery_status: 'new',
      is_active: true,
      cm_last_refreshed_at: new Date().toISOString(),
    })

    if (error) {
      results.push({ name: lead.name, status: 'error' })
      continue
    }

    // Brand affinities
    await sleep(500)
    try {
      const brandRes = await fetch(`${CM_BASE}/artist/${cmId}/instagram-audience-data?field=brandAffinity`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (brandRes.ok) {
        const brands = ((await brandRes.json())?.obj || []).filter((b: any) => b.affinity >= 1.0)
        if (brands.length) {
          await supabase.from('intel_artist_brand_affinities').insert(
            brands.map((b: any) => ({
              chartmetric_id: cmId,
              brand_id: b.id || 0,
              brand_name: b.name,
              affinity_scale: b.affinity,
              follower_count: b.followers || null,
              interest_category: b.category || null,
            }))
          )
        }
      }
    } catch { /* skip */ }

    // Sector affinities
    await sleep(500)
    try {
      const sectorRes = await fetch(`${CM_BASE}/artist/${cmId}/instagram-audience-data?field=interests`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (sectorRes.ok) {
        const sectors = ((await sectorRes.json())?.obj || []).filter((s: any) => s.affinity >= 1.0)
        if (sectors.length) {
          await supabase.from('intel_artist_sector_affinities').insert(
            sectors.map((s: any) => ({
              chartmetric_id: cmId,
              sector_id: s.id || 0,
              sector_name: s.name,
              affinity_scale: s.affinity,
            }))
          )
        }
      }
    } catch { /* skip */ }

    // Activity log
    await supabase.from('activity_log').insert({
      chartmetric_id: cmId,
      event_type: 'added_to_pipeline',
      event_title: `Tour lead submitted by ${submittedBy} via ${source}`,
      event_detail: { tour_info: lead.tourInfo, source },
      event_date: new Date().toISOString().split('T')[0],
    })

    results.push({ name: lead.name, status: 'created', chartmetric_id: cmId })
  }

  return NextResponse.json({
    success: true,
    total: results.length,
    created: results.filter(r => r.status === 'created').length,
    existing: results.filter(r => r.status === 'exists').length,
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
