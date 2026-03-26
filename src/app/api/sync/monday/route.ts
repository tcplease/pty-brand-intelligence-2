import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createServiceClient } from '@/lib/supabase'

const BOARD_ID = '2696356409'
const CRM_BOARD_ID = '2696356486'

// ── Column maps ───────────────────────────────────────
const COLUMN_MAP = {
  text__1: 'tour',
  person: 'sales_lead',
  status: 'stage',
  numbers0: 'close_probability',
  tags6: 'project_type',
  priority: 'priority',
  numbers__1: 'total_events',
  mirror6: 'first_show',
  mirror23: 'last_show',
  numbers02: 'proj_gross',
  numbers: 'proj_pty_net',
  mirror21: 'announce_date',
  mirror20: 'pre_sale_date',
  mirror16: 'on_sale_date',
  date1: 'deal_creation_date',
} as const

const NUMBER_COLS = new Set(['numbers0', 'numbers__1', 'numbers02', 'numbers'])
const DATE_COLS = new Set(['mirror6', 'mirror23', 'mirror21', 'mirror20', 'mirror16', 'date1'])
const TEXT_COLS = new Set(['text__1', 'person', 'status', 'tags6', 'priority'])

// ── Helpers ───────────────────────────────────────────
function parseColumnValue(colId: string, text: string | null, value: string | null, displayValue?: string | null) {
  if (!text && !value && !displayValue) return null

  if (NUMBER_COLS.has(colId)) {
    const num = parseFloat(text || '')
    return isNaN(num) ? null : num
  }

  if (DATE_COLS.has(colId)) {
    // Try structured value first
    if (value) {
      try {
        const parsed = JSON.parse(value)
        if (parsed.date) return parsed.date
      } catch {}
    }
    // Try text field
    if (text && /^\d{4}-\d{2}-\d{2}/.test(text)) {
      return text.split('T')[0]
    }
    // Try display_value (critical for mirror columns)
    if (displayValue) {
      const dateMatch = displayValue.match(/(\d{4}-\d{2}-\d{2})/)
      if (dateMatch) return dateMatch[1]
    }
    return null
  }

  if (TEXT_COLS.has(colId)) {
    return text || null
  }

  return text || null
}

function getLinkedItemIds(columnValues: any[], id: string): string[] {
  const col = columnValues.find((c: any) => c.id === id)
  if (!col?.value) return []
  try {
    const parsed = JSON.parse(col.value)
    return (parsed?.linkedPulseIds || []).map((l: any) => String(l.linkedPulseId))
  } catch {
    return []
  }
}

function getColText(columnValues: any[], id: string): string | null {
  const col = columnValues.find((c: any) => c.id === id)
  return col?.text || null
}

// ── Fetch all items from a board ──────────────────────
async function fetchAllBoardItems(boardId: string, extraFields = '') {
  const allItems: any[] = []
  let cursor: string | null = null

  do {
    const cursorArg: string = cursor ? `, cursor: "${cursor}"` : ''
    const query = `{
      boards(ids: ${boardId}) {
        items_page(limit: 100${cursorArg}) {
          cursor
          items {
            id
            name
            ${extraFields}
            column_values { id type text value ... on MirrorValue { display_value } }
          }
        }
      }
    }`

    const res = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
        'API-Version': '2023-10',
      },
      body: JSON.stringify({ query }),
    })

    const json = await res.json()
    if (json.errors) throw new Error(`Monday API error: ${JSON.stringify(json.errors)}`)

    const page = json.data.boards[0].items_page
    allItems.push(...page.items)
    cursor = page.cursor || null
    console.log(`[${boardId}] Fetched ${allItems.length} items...`)
  } while (cursor)

  return allItems
}

// ── Step 1: Sync deals ────────────────────────────────
async function syncDeals() {
  const items = await fetchAllBoardItems(BOARD_ID, 'group { title }')
  console.log(`Total deal items from Monday: ${items.length}`)

  const rows = items.map((item: any) => {
    const row: Record<string, any> = {
      monday_item_id: parseInt(item.id),
      artist_name: item.name,
      monday_last_synced_at: new Date().toISOString(),
    }

    for (const col of item.column_values) {
      const supaCol = COLUMN_MAP[col.id as keyof typeof COLUMN_MAP]
      if (supaCol) {
        row[supaCol] = parseColumnValue(col.id, col.text, col.value, col.display_value)
      }
    }

    return row
  })

  const BATCH_SIZE = 200
  let upserted = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('intel_monday_items')
      .upsert(batch, { onConflict: 'monday_item_id' })

    if (error) throw new Error(`Deals batch error at ${i}: ${error.message}`)
    upserted += batch.length
    console.log(`Deals upserted ${upserted}/${rows.length}`)
  }

  return { total: items.length, upserted, items }
}

// ── Contact mirror columns on the DEAL board ─────────
// These mirror columns on the deals board contain contact info
// pulled from the connected CRM board (2696356486)
const CONTACT_MIRRORS = {
  mirror0: 'management_company',            // e.g. "Palm Tree Crew"
  lookup_mkkyxpdw: 'manager_email',         // e.g. "myles@palmtreemgmt.com"
  mirror_mkkbdz5z: 'agent_company',         // e.g. "Wasserman"
  dup__of_agent_company_mkkywgqg: 'agent_email', // e.g. "ehancock@teamwass.com"
} as const

// ── Step 2: Sync contacts from deal board mirrors ────
async function syncContacts(dealItems: any[]) {
  const serviceClient = createServiceClient()

  // Get deal ID → chartmetric_id mapping
  const { data: mondayItems, error: mondayError } = await serviceClient
    .from('intel_monday_items')
    .select('monday_item_id, chartmetric_id')
    .not('chartmetric_id', 'is', null)

  if (mondayError) throw mondayError

  const dealIdToCmId = new Map<string, number>()
  for (const item of mondayItems || []) {
    dealIdToCmId.set(String(item.monday_item_id), item.chartmetric_id)
  }

  console.log(`Deal->artist mappings: ${dealIdToCmId.size}`)

  // Extract contacts from deal board mirror columns
  const contactMap = new Map<string, any>() // key: cmId|role|email to dedupe

  for (const item of dealItems) {
    const cmId = dealIdToCmId.get(String(item.id))
    if (!cmId) continue

    const cols = item.column_values || []

    // Helper to get display_value from a mirror column
    const getMirror = (colId: string): string | null => {
      const col = cols.find((c: any) => c.id === colId)
      return col?.display_value || col?.text || null
    }

    const mgmtCompany = getMirror('mirror0')
    const mgmtEmails = getMirror('lookup_mkkyxpdw')
    const agentCompany = getMirror('mirror_mkkbdz5z')
    const agentEmails = getMirror('dup__of_agent_company_mkkywgqg')

    // Parse management contacts (can be comma-separated)
    if (mgmtEmails) {
      const emails = mgmtEmails.split(',').map((e: string) => e.trim()).filter((e: string) => e.includes('@'))
      const companies = mgmtCompany ? mgmtCompany.split(',').map((c: string) => c.trim()) : []

      for (const email of emails) {
        const key = `${cmId}|manager|${email}`
        if (!contactMap.has(key)) {
          contactMap.set(key, {
            chartmetric_id: cmId,
            role: 'manager',
            contact_name: null,
            company_name: companies[0] || null,
            email,
            phone: null,
            linkedin_url: null,
            source: 'monday',
            last_verified_at: new Date().toISOString(),
          })
        }
      }
    }

    // Parse agent contacts
    if (agentEmails) {
      const emails = agentEmails.split(',').map((e: string) => e.trim()).filter((e: string) => e.includes('@'))
      const companies = agentCompany ? agentCompany.split(',').map((c: string) => c.trim()) : []

      for (const email of emails) {
        const key = `${cmId}|agent|${email}`
        if (!contactMap.has(key)) {
          contactMap.set(key, {
            chartmetric_id: cmId,
            role: 'agent',
            contact_name: null,
            company_name: companies[0] || null,
            email,
            phone: null,
            linkedin_url: null,
            source: 'monday',
            last_verified_at: new Date().toISOString(),
          })
        }
      }
    }
  }

  const toInsert = Array.from(contactMap.values())
  console.log(`Contacts extracted from deal mirrors: ${toInsert.length}`)

  if (toInsert.length === 0) {
    return { total: dealItems.length, upserted: 0 }
  }

  // Also pull from CRM board for additional contacts (names, phones, etc.)
  try {
    const crmContacts = await fetchAllBoardItems(CRM_BOARD_ID)
    console.log(`CRM board contacts: ${crmContacts.length}`)

    for (const contact of crmContacts) {
      const cols = contact.column_values || []
      const name = contact.name || null
      const email = getColText(cols, 'email')
      const phone = getColText(cols, 'phone')

      const managerDealIds = getLinkedItemIds(cols, 'link_to___deals')
      const agentDealIds = getLinkedItemIds(cols, 'link_to_events_deals_mkkbg5x5')
      const bizDealIds = getLinkedItemIds(cols, 'connect_boards_mkkbkjg7')

      let role: 'manager' | 'agent' | 'business_manager' = 'manager'
      let dealIds = managerDealIds

      if (agentDealIds.length > 0) { role = 'agent'; dealIds = agentDealIds }
      else if (bizDealIds.length > 0) { role = 'business_manager'; dealIds = bizDealIds }
      else if (managerDealIds.length > 0) { role = 'manager'; dealIds = managerDealIds }
      else continue

      for (const dealId of dealIds) {
        const cmId = dealIdToCmId.get(dealId)
        if (!cmId) continue

        if (email) {
          const key = `${cmId}|${role}|${email}`
          // Enrich existing or add new
          if (contactMap.has(key)) {
            const existing = contactMap.get(key)
            if (name) existing.contact_name = name
            if (phone) existing.phone = phone
          } else {
            contactMap.set(key, {
              chartmetric_id: cmId,
              role,
              contact_name: name,
              company_name: null,
              email,
              phone,
              linkedin_url: null,
              source: 'monday',
              last_verified_at: new Date().toISOString(),
            })
          }
        } else if (name) {
          // Contact with name but no email
          const key = `${cmId}|${role}|${name}`
          if (!contactMap.has(key)) {
            contactMap.set(key, {
              chartmetric_id: cmId,
              role,
              contact_name: name,
              company_name: null,
              email: null,
              phone,
              linkedin_url: null,
              source: 'monday',
              last_verified_at: new Date().toISOString(),
            })
          }
        }
      }
    }
  } catch (crmErr: any) {
    console.error('CRM board fetch failed (non-fatal):', crmErr.message)
  }

  const finalContacts = Array.from(contactMap.values())
  console.log(`Total contacts after CRM enrichment: ${finalContacts.length}`)

  // Clear existing Monday contacts and re-insert
  const { error: deleteError } = await serviceClient
    .from('intel_artist_contacts')
    .delete()
    .eq('source', 'monday')

  if (deleteError) throw deleteError

  const BATCH = 200
  let upserted = 0

  for (let i = 0; i < finalContacts.length; i += BATCH) {
    const batch = finalContacts.slice(i, i + BATCH)
    const { error } = await serviceClient
      .from('intel_artist_contacts')
      .insert(batch)

    if (error) {
      console.error(`Contacts batch error at ${i}:`, error.message)
    } else {
      upserted += batch.length
    }
  }

  console.log(`Contacts upserted: ${upserted}`)
  return { total: finalContacts.length, upserted }
}

// ── CM enrichment for new artists ─────────────────────
const CM_REFRESH_TOKEN = process.env.CHARTMETRIC_TOKEN!
const CM_BASE = 'https://api.chartmetric.com/api'

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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ── Step 2.5: Auto-link unlinked Monday items to existing artists ──
async function autoLinkByName() {
  const serviceClient = createServiceClient()

  // Get all unlinked Monday items
  const { data: unlinked } = await serviceClient
    .from('intel_monday_items')
    .select('monday_item_id, artist_name')
    .is('chartmetric_id', null)

  if (!unlinked?.length) return { linked: 0 }

  // Get all artist names from intel_artists for matching
  const { data: artists } = await serviceClient
    .from('intel_artists')
    .select('chartmetric_id, name')

  if (!artists?.length) return { linked: 0 }

  // Build case-insensitive lookup map
  const nameToCmId = new Map<string, number>()
  for (const a of artists) {
    nameToCmId.set(a.name.toLowerCase().trim(), a.chartmetric_id)
  }

  let linked = 0
  for (const item of unlinked) {
    const cmId = nameToCmId.get(item.artist_name.toLowerCase().trim())
    if (cmId) {
      await serviceClient
        .from('intel_monday_items')
        .update({ chartmetric_id: cmId })
        .eq('monday_item_id', item.monday_item_id)

      // Ensure the artist is marked as pipeline
      await serviceClient
        .from('intel_artists')
        .update({ discovery_status: 'pipeline', source: 'both' })
        .eq('chartmetric_id', cmId)

      linked++
    }
  }

  console.log(`Auto-linked ${linked} Monday items by name match`)
  return { linked }
}

async function enrichNewArtists() {
  // Find Monday items with chartmetric_id that don't have a matching intel_artists record
  const { data: mondayItems } = await supabase
    .from('intel_monday_items')
    .select('chartmetric_id, artist_name')
    .not('chartmetric_id', 'is', null)

  if (!mondayItems?.length) return { enriched: 0, cm_calls: 0 }

  const cmIds = [...new Set(mondayItems.map(i => i.chartmetric_id))]

  const { data: existingArtists } = await supabase
    .from('intel_artists')
    .select('chartmetric_id')
    .in('chartmetric_id', cmIds)

  const existingSet = new Set((existingArtists || []).map(a => a.chartmetric_id))
  const newItems = mondayItems.filter(i => !existingSet.has(i.chartmetric_id))

  // Dedupe by chartmetric_id
  const seen = new Set<number>()
  const toEnrich = newItems.filter(i => {
    if (seen.has(i.chartmetric_id)) return false
    seen.add(i.chartmetric_id)
    return true
  })

  if (!toEnrich.length) return { enriched: 0, cm_calls: 0 }

  let cmToken: string
  try {
    cmToken = await getCMToken()
  } catch {
    console.error('CM token failed, skipping enrichment')
    return { enriched: 0, cm_calls: 0, error: 'CM token failed' }
  }

  let enriched = 0
  let cmCalls = 0

  for (const item of toEnrich) {
    try {
      const cmId = item.chartmetric_id

      // Profile
      await sleep(600)
      const profRes = await fetch(`${CM_BASE}/artist/${cmId}`, {
        headers: { Authorization: `Bearer ${cmToken}` },
      })
      cmCalls++
      if (!profRes.ok) continue
      const p = (await profRes.json()).obj
      if (!p) continue

      // Career stage
      await sleep(500)
      const careerRes = await fetch(`${CM_BASE}/artist/${cmId}/career?limit=1`, {
        headers: { Authorization: `Bearer ${cmToken}` },
      })
      cmCalls++
      const career = (await careerRes.json()).obj?.[0]

      // Brand affinities
      await sleep(500)
      const brandRes = await fetch(`${CM_BASE}/artist/${cmId}/instagram-audience-data?field=brandAffinity`, {
        headers: { Authorization: `Bearer ${cmToken}` },
      })
      cmCalls++
      const brands = ((await brandRes.json()).obj || []).filter((b: any) => (b.affinity || 0) >= 1.0)

      // Sector affinities
      await sleep(500)
      const sectorRes = await fetch(`${CM_BASE}/artist/${cmId}/instagram-audience-data?field=interests`, {
        headers: { Authorization: `Bearer ${cmToken}` },
      })
      cmCalls++
      const sectors = ((await sectorRes.json()).obj || []).filter((s: any) => (s.affinity || 0) >= 1.0)

      // Spotify ID from URLs
      await sleep(500)
      const urlsRes = await fetch(`${CM_BASE}/artist/${cmId}/urls`, {
        headers: { Authorization: `Bearer ${cmToken}` },
      })
      cmCalls++
      const urls = (await urlsRes.json()).obj || []
      const spotifyUrl = urls.find((u: any) => u.domain === 'spotify')?.url?.[0] || ''
      const spotifyId = spotifyUrl.match(/artist\/([a-zA-Z0-9]+)/)?.[1] || null

      // Demographics
      await sleep(500)
      const demoRes = await fetch(`${CM_BASE}/artist/${cmId}/instagram-audience-data?field=demographics`, {
        headers: { Authorization: `Bearer ${cmToken}` },
      })
      cmCalls++
      const demo = (await demoRes.json()).obj

      // Social stats from /stat/ endpoints (profile does NOT return these)
      const socialStats: Record<string, number | null> = {
        spotify_followers: null,
        spotify_monthly_listeners: null,
        instagram_followers: null,
        youtube_subscribers: null,
        tiktok_followers: null,
      }
      const statEndpoints = [
        { path: 'stat/spotify', extract: (d: any) => { socialStats.spotify_followers = d?.obj?.followers?.[0]?.value ?? null; socialStats.spotify_monthly_listeners = d?.obj?.monthly_listeners?.[0]?.value ?? null } },
        { path: 'stat/instagram', extract: (d: any) => { socialStats.instagram_followers = d?.obj?.followers?.[0]?.value ?? null } },
        { path: 'stat/youtube_channel', extract: (d: any) => { socialStats.youtube_subscribers = d?.obj?.subscribers?.[0]?.value ?? null } },
        { path: 'stat/tiktok', extract: (d: any) => { socialStats.tiktok_followers = d?.obj?.followers?.[0]?.value ?? null } },
      ]
      for (const ep of statEndpoints) {
        try {
          await sleep(400)
          const statRes = await fetch(`${CM_BASE}/artist/${cmId}/${ep.path}`, {
            headers: { Authorization: `Bearer ${cmToken}` },
          })
          cmCalls++
          if (statRes.ok) ep.extract(await statRes.json())
        } catch { /* skip */ }
      }

      // Insert artist
      const artistData: Record<string, unknown> = {
        chartmetric_id: cmId,
        name: p.name || item.artist_name,
        image_url: p.image_url || null,
        cm_score: p.cm_artist_score || null,
        career_stage: career?.stage || null,
        primary_genre: p.artist_genres?.[0]?.name || null,
        ...socialStats,
        audience_male_pct: p.sp_fans_male_pct || null,
        audience_female_pct: p.sp_fans_female_pct || null,
        spotify_artist_id: spotifyId,
        source: 'monday',
        discovery_status: 'pipeline',
        is_active: true,
        cm_last_refreshed_at: new Date().toISOString(),
      }

      // Add demographics if available
      if (demo?.ages) {
        const ages = demo.ages
        artistData.age_13_17_pct = ages['13-17'] ?? null
        artistData.age_18_24_pct = ages['18-24'] ?? null
        artistData.age_25_34_pct = ages['25-34'] ?? null
        artistData.age_35_44_pct = ages['35-44'] ?? null
        artistData.age_45_64_pct = ages['45-64'] ?? null
        artistData.age_65_plus_pct = ages['65+'] ?? null
      }

      await supabase.from('intel_artists').insert(artistData)

      // Insert brand affinities
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

      // Insert sector affinities
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

      enriched++
      console.log(`Enriched: ${p.name} (CM ${cmId}) — ${brands.length} brands, ${sectors.length} sectors`)
    } catch (err: any) {
      console.error(`Failed to enrich CM ${item.chartmetric_id}:`, err.message)
    }
  }

  return { enriched, cm_calls: cmCalls }

}

// ── Main handler ──────────────────────────────────────

// GET handler for Vercel Cron
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runMondaySync()
}

// POST handler for manual triggers
export async function POST() {
  return runMondaySync()
}

async function runMondaySync() {
  try {
    console.log('Starting Monday sync...')

    const deals = await syncDeals()
    console.log('Deals sync complete:', { total: deals.total, upserted: deals.upserted })

    // Auto-link unlinked Monday items to existing intel_artists by name (case-insensitive)
    const autoLinked = await autoLinkByName()
    console.log('Auto-link complete:', autoLinked)

    const contacts = await syncContacts(deals.items)
    console.log('Contacts sync complete:', contacts)

    // Enrich any new artists that don't have CM data yet
    const enrichment = await enrichNewArtists()
    console.log('Enrichment complete:', enrichment)

    return NextResponse.json({
      success: true,
      deals,
      autoLinked,
      contacts,
      enrichment,
    })
  } catch (err: any) {
    console.error('Monday sync failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}