import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createServiceClient } from '@/lib/supabase'
import { resolveAndEnrichArtist } from '@/lib/resolve-artist'
import {
  latestStatValue,
  getInstagramAudience,
  extractDemographics,
  extractBrandAffinities,
  extractSectorAffinities,
  extractSocialUrls,
} from '@/lib/chartmetric'

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

// Stages whose artists appear in the app (per docs/monday-data-reference.md).
// Lost / Tour Canceled / Fell Off / Closed are excluded from CM search + enrichment.
const VISIBLE_STAGES = new Set([
  'Outbound - No Contact',
  'Outbound - Automated Contact',
  'Prospect - Direct Sales Agent Contact',
  'Active Leads (Contact Has Responded)',
  'Proposal (financials submitted)',
  'Negotiation (Terms Being Discussed)',
  'Finalizing On-Sale (Terms Agreed)',
  'Won (Final On-Sale Planned)',
])

// Search priority (higher = searched first within the per-run cap). Live/closer-to-won
// deals jump the queue so newer Won/mid-funnel deals never starve behind the backlog.
const STAGE_PRIORITY: Record<string, number> = {
  'Won (Final On-Sale Planned)': 8,
  'Finalizing On-Sale (Terms Agreed)': 7,
  'Negotiation (Terms Being Discussed)': 6,
  'Proposal (financials submitted)': 5,
  'Active Leads (Contact Has Responded)': 4,
  'Prospect - Direct Sales Agent Contact': 3,
  'Outbound - Automated Contact': 2,
  'Outbound - No Contact': 1,
}

// Per-run caps keep CM cost bounded on the hourly cron; the queue drains across runs.
const MAX_SEARCHES_PER_RUN = 25
const MAX_ENRICH_PER_RUN = 25
const CM_SEARCH_RETRY_DAYS = 30 // re-attempt a 'no_match' name after this many days

// ── Helpers ───────────────────────────────────────────
// Supabase caps responses at 1000 rows; intel_artists and intel_monday_items
// both exceed that, so every full-table read must paginate.
async function fetchAllRows(
  client: typeof supabase,
  table: string,
  select: string,
  applyFilters?: (q: any) => any // eslint-disable-line @typescript-eslint/no-explicit-any -- Supabase builder type varies per filter chain
) {
  const PAGE = 1000
  let from = 0
  const rows: any[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any -- shape depends on select string
  while (true) {
    let q: any = client.from(table).select(select).range(from, from + PAGE - 1) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (applyFilters) q = applyFilters(q)
    const { data, error } = await q
    if (error) throw new Error(`${table} paged fetch error: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return rows
}

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
  const mondayItems = await fetchAllRows(
    serviceClient,
    'intel_monday_items',
    'monday_item_id, chartmetric_id',
    q => q.not('chartmetric_id', 'is', null)
  )

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
  const unlinked = await fetchAllRows(
    serviceClient,
    'intel_monday_items',
    'monday_item_id, artist_name',
    q => q.is('chartmetric_id', null)
  )

  if (!unlinked.length) return { linked: 0 }

  // Get all artist names from intel_artists for matching
  const artists = await fetchAllRows(serviceClient, 'intel_artists', 'chartmetric_id, name')

  if (!artists.length) return { linked: 0 }

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

// ── CM name search for brand-new Monday artists ──────
// Items the team creates directly in Monday have no chartmetric_id and no
// intel_artists row, so neither autoLinkByName nor enrichNewArtists can see
// them. This step searches CM by name and links only exact, unambiguous
// matches; everything else is reported as unmatched for manual linking.
//
// intel_monday_items.chartmetric_id has an FK to intel_artists, so a match
// whose artist row doesn't exist yet can't be linked here — it's returned as
// a PendingLink and enrichNewArtists links it after inserting the artist.
interface PendingLink {
  cmId: number
  name: string
  itemIds: number[]
}

async function searchAndLinkNewArtists(testNames?: string[]) {
  const serviceClient = createServiceClient()

  const unlinked = await fetchAllRows(
    serviceClient,
    'intel_monday_items',
    'monday_item_id, artist_name, stage, cm_search_attempted_at, cm_search_result',
    q => q.is('chartmetric_id', null)
  )

  const retryCutoff = new Date(Date.now() - CM_SEARCH_RETRY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const testNameSet = testNames?.length
    ? new Set(testNames.map(n => n.toLowerCase().trim()))
    : null

  const visible = unlinked.filter(i =>
    VISIBLE_STAGES.has(i.stage) &&
    (!testNameSet || testNameSet.has(i.artist_name.toLowerCase().trim()))
  )

  // Negative cache: never searched, or 'no_match' old enough to retry.
  // 'ambiguous' is excluded — those wait for manual resolution.
  const candidates = visible.filter(i =>
    i.cm_search_result === null ||
    (i.cm_search_result === 'no_match' && i.cm_search_attempted_at < retryCutoff)
  )

  // Surface cached-ambiguous items every run so they don't get forgotten
  const awaitingManual = [...new Set(
    visible.filter(i => i.cm_search_result === 'ambiguous').map(i => i.artist_name)
  )].sort()
  if (awaitingManual.length) {
    console.log(`CM search: ${awaitingManual.length} names awaiting manual linking: ${awaitingManual.join(', ')}`)
  }

  if (!candidates.length) {
    return { searched: 0, linked: 0, deferred: 0, awaiting_manual: awaitingManual, results: [], errors: [] }
  }

  // Group items by normalized name so one search covers all deals for an artist.
  // Track the highest-priority stage + whether ANY item is never-searched so the
  // per-run cap front-loads live deals and never-searched names.
  const byName = new Map<string, { display: string; itemIds: number[]; priority: number; neverSearched: boolean }>()
  for (const item of candidates) {
    const key = item.artist_name.toLowerCase().trim()
    const group = byName.get(key) || { display: item.artist_name, itemIds: [] as number[], priority: 0, neverSearched: false }
    group.itemIds.push(item.monday_item_id)
    group.priority = Math.max(group.priority, STAGE_PRIORITY[item.stage] ?? 0)
    if (item.cm_search_attempted_at === null) group.neverSearched = true
    byName.set(key, group)
  }

  // ORDER BEFORE THE CAP SLICE (Part 3 fix): never-searched first, then stage
  // priority. The old `names.slice(0, 25)` took an arbitrary fixed front every run,
  // so newer Won deals (Good Charlotte, Blondshell) sat past position 25 and never
  // got searched. Ordering makes the 25/run budget rotate through the whole backlog
  // and front-load live deals.
  const ordered = Array.from(byName.entries()).sort((a, b) => {
    if (a[1].neverSearched !== b[1].neverSearched) return a[1].neverSearched ? -1 : 1
    return b[1].priority - a[1].priority
  })
  const toSearch = ordered.slice(0, MAX_SEARCHES_PER_RUN)
  const deferred = ordered.length - toSearch.length
  if (deferred > 0) console.log(`CM search: ${deferred} names deferred to next run (cap ${MAX_SEARCHES_PER_RUN})`)

  let cmToken: string
  try {
    cmToken = await getCMToken()
  } catch {
    console.error('CM token failed, skipping name search')
    return { searched: 0, linked: 0, deferred: ordered.length, awaiting_manual: awaitingManual, results: [], errors: ['CM token failed'] }
  }

  // Reuse-before-pay needs the current roster — resolveAndEnrichArtist matches
  // (normalized + trigram) against it BEFORE any Chartmetric call, so a name we
  // already own links at zero CM spend.
  const roster = await fetchAllRows(serviceClient, 'intel_artists', 'chartmetric_id, name, spotify_followers, instagram_followers')
  const deps = {
    client: serviceClient,
    getToken: async () => cmToken,
    existing: roster.map(r => ({ chartmetric_id: r.chartmetric_id, name: r.name, followers: Math.max(r.spotify_followers ?? 0, r.instagram_followers ?? 0) || null })),
    source: 'monday',
    discoveryStatus: 'pipeline',
  }

  let linked = 0
  const results: { name: string; outcome: string; chartmetric_id: number | null; rowCreated: boolean; note?: string; error?: string }[] = []
  const errors: string[] = []
  const now = new Date().toISOString()

  for (const [, group] of toSearch) {
    await sleep(400)
    const r = await resolveAndEnrichArtist(group.display, deps)
    results.push({ name: group.display, outcome: r.outcome, chartmetric_id: r.chartmetric_id, rowCreated: r.rowCreated, note: r.note, error: r.error })

    if (r.outcome === 'error') {
      // Surface, never freeze — no cache stamp, so the name retries cleanly next run.
      errors.push(`${group.display}: ${r.error}`)
      console.error(`resolve failed for "${group.display}": ${r.error}`)
      continue
    }

    if (r.outcome === 'needs-review') {
      // Low-confidence resolution (confidence floor) — surface for manual linking,
      // do NOT auto-create/link. Stamp 'ambiguous' (already handled as awaiting-manual,
      // never auto-retried), so it doesn't burn the cap every run.
      await serviceClient
        .from('intel_monday_items')
        .update({ cm_search_attempted_at: now, cm_search_result: 'ambiguous' })
        .in('monday_item_id', group.itemIds)
      console.log(`needs-review: ${group.display} (${(r.reasons ?? []).join(', ')}) ${r.note ?? ''}`)
      continue
    }

    if (r.chartmetric_id) {
      // Link all of this artist's deals. cm_search_result stays NULL on link.
      const { error: updErr } = await serviceClient
        .from('intel_monday_items')
        .update({ chartmetric_id: r.chartmetric_id, cm_search_result: null })
        .in('monday_item_id', group.itemIds)
      if (updErr) { errors.push(`link ${group.display}: ${updErr.message}`); continue }
      // Existing artist now also on a Monday deal → mark pipeline-visible (mirrors
      // autoLinkByName). A freshly inserted row already carries source='monday'/
      // discovery_status='pipeline', so only touch the matched-existing case.
      if (!r.rowCreated) {
        await serviceClient
          .from('intel_artists')
          .update({ discovery_status: 'pipeline', source: 'both' })
          .eq('chartmetric_id', r.chartmetric_id)
      }
      linked += group.itemIds.length
      console.log(`CM resolve linked: ${group.display} → CM ${r.chartmetric_id} (${r.outcome}, ${group.itemIds.length} items)`)
      continue
    }

    // True no-match (Chartmetric returned ZERO candidates) — the ONLY case that
    // stamps the negative cache. Ambiguous never reaches here (it tiebreaks above).
    const { error: ncErr } = await serviceClient
      .from('intel_monday_items')
      .update({ cm_search_attempted_at: now, cm_search_result: 'no_match' })
      .in('monday_item_id', group.itemIds)
    if (ncErr) errors.push(`cache ${group.display}: ${ncErr.message}`)
  }

  return { searched: toSearch.length, linked, deferred, awaiting_manual: awaitingManual, results, errors }
}

async function enrichNewArtists(testNames?: string[], pendingLinks: PendingLink[] = []) {
  // Find Monday items with chartmetric_id that don't have a matching intel_artists record.
  // Only visible-stage items qualify — Lost/Fell Off/Canceled deals don't trigger CM spend.
  let mondayItems = await fetchAllRows(
    supabase,
    'intel_monday_items',
    'chartmetric_id, artist_name, stage',
    q => q.not('chartmetric_id', 'is', null)
  )
  mondayItems = mondayItems.filter(i => VISIBLE_STAGES.has(i.stage))

  if (testNames?.length) {
    const testNameSet = new Set(testNames.map(n => n.toLowerCase().trim()))
    mondayItems = mondayItems.filter(i => testNameSet.has(i.artist_name.toLowerCase().trim()))
  }

  // Name-search matches awaiting their artist row go first; itemIds marks
  // them for linking once the insert succeeds (FK requires artist-first).
  mondayItems = [
    ...pendingLinks.map(p => ({ chartmetric_id: p.cmId, artist_name: p.name, itemIds: p.itemIds })),
    ...mondayItems,
  ]

  if (!mondayItems.length) return { enriched: 0, cm_calls: 0 }

  const cmIds = [...new Set(mondayItems.map(i => i.chartmetric_id))]

  // .in() with >1000 ids breaks both URL length and the response row cap — chunk it
  const existingSet = new Set<number>()
  for (let i = 0; i < cmIds.length; i += 500) {
    const { data: chunk, error } = await supabase
      .from('intel_artists')
      .select('chartmetric_id')
      .in('chartmetric_id', cmIds.slice(i, i + 500))
    if (error) throw new Error(`intel_artists existence check error: ${error.message}`)
    for (const a of chunk || []) existingSet.add(a.chartmetric_id)
  }
  const newItems = mondayItems.filter(i => !existingSet.has(i.chartmetric_id))

  // Dedupe by chartmetric_id
  const seen = new Set<number>()
  let toEnrich = newItems.filter(i => {
    if (seen.has(i.chartmetric_id)) return false
    seen.add(i.chartmetric_id)
    return true
  })

  if (!toEnrich.length) return { enriched: 0, cm_calls: 0 }

  // Bound CM spend per run (~8 calls per artist); the hourly cron drains the rest
  const enrichDeferred = Math.max(0, toEnrich.length - MAX_ENRICH_PER_RUN)
  if (enrichDeferred > 0) {
    console.log(`Enrichment: ${enrichDeferred} artists deferred to next run (cap ${MAX_ENRICH_PER_RUN})`)
    toEnrich = toEnrich.slice(0, MAX_ENRICH_PER_RUN)
  }

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
      const career = careerRes.ok ? (await careerRes.json()).obj?.[0] : undefined

      // Instagram audience — one call returns demographics + brand + sector
      // affinities (instagram-audience-stats). Returns null when the artist has
      // no IG audience data, which must not abort enrichment.
      await sleep(500)
      const audience = await getInstagramAudience(cmId, cmToken)
      cmCalls++
      const brands = audience ? extractBrandAffinities(audience, cmId) : []
      const sectors = audience ? extractSectorAffinities(audience, cmId) : []

      // Spotify ID + social profile URLs from /urls (one call)
      await sleep(500)
      const urlsRes = await fetch(`${CM_BASE}/artist/${cmId}/urls`, {
        headers: { Authorization: `Bearer ${cmToken}` },
      })
      cmCalls++
      const socialUrls = extractSocialUrls(urlsRes.ok ? ((await urlsRes.json()).obj || []) : [])
      const spotifyId = socialUrls.spotify_artist_id

      // Social stats from /stat/ endpoints (profile does NOT return these)
      const socialStats: Record<string, number | null> = {
        spotify_followers: null,
        spotify_monthly_listeners: null,
        instagram_followers: null,
        youtube_subscribers: null,
        tiktok_followers: null,
      }
      const statEndpoints = [
        { path: 'stat/spotify', extract: (d: any) => { socialStats.spotify_followers = d?.obj?.followers?.[0]?.value ?? null; socialStats.spotify_monthly_listeners = latestStatValue(d?.obj?.listeners) } },
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
        spotify_artist_id: spotifyId,
        instagram_url: socialUrls.instagram_url,
        youtube_url: socialUrls.youtube_url,
        tiktok_url: socialUrls.tiktok_url,
        source: 'monday',
        discovery_status: 'pipeline',
        is_active: true,
        cm_last_refreshed_at: new Date().toISOString(),
      }

      // Demographics from the audience payload (gender, age, ethnicity, top
      // countries) via the shared extractor — only merge non-null fields.
      if (audience) {
        if (audience.followers) artistData.instagram_followers = audience.followers
        const demographics = extractDemographics(audience)
        for (const [key, val] of Object.entries(demographics)) {
          if (val !== null && val !== undefined) artistData[key] = val
        }
      }

      const { error: insertError } = await supabase.from('intel_artists').insert(artistData)
      if (insertError) {
        console.error(`Failed to insert artist ${p.name} (CM ${cmId}):`, insertError.message)
        continue
      }

      // Artist row now exists — complete any deferred name-search link.
      // cm_search_result stays NULL: linked items are identified by chartmetric_id.
      if (item.itemIds?.length) {
        const { error: linkError } = await createServiceClient()
          .from('intel_monday_items')
          .update({
            chartmetric_id: cmId,
            cm_search_attempted_at: new Date().toISOString(),
            cm_search_result: null,
          })
          .in('monday_item_id', item.itemIds)
        if (linkError) {
          console.error(`Failed to link Monday items for ${p.name} (CM ${cmId}):`, linkError.message)
        } else {
          console.log(`Linked ${item.itemIds.length} Monday items for ${p.name} (CM ${cmId})`)
        }
      }

      // Insert brand affinities
      // brands/sectors are already full row objects from the shared extractors
      if (brands.length) {
        await supabase.from('intel_brand_affinities').insert(brands)
      }

      // Insert sector affinities
      if (sectors.length) {
        await supabase.from('intel_sector_affinities').insert(sectors)
      }

      enriched++
      console.log(`Enriched: ${p.name} (CM ${cmId}) — ${brands.length} brands, ${sectors.length} sectors`)
    } catch (err: any) {
      console.error(`Failed to enrich CM ${item.chartmetric_id}:`, err.message)
    }
  }

  return { enriched, cm_calls: cmCalls, deferred: enrichDeferred }

}

// ── Main handler ──────────────────────────────────────

// ?names=TEN,Rebecca Black — restrict CM search + enrichment to specific
// artists (used for the test-before-batch protocol; deals/contacts still sync fully)
function parseTestNames(request: Request): string[] | undefined {
  const raw = new URL(request.url).searchParams.get('names')
  if (!raw) return undefined
  const names = raw.split(',').map(n => n.trim()).filter(Boolean)
  return names.length ? names : undefined
}

// GET handler for Vercel Cron
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const testNames = parseTestNames(request)
  if (testNames) return runResolveTest(testNames)
  return runMondaySync()
}

// POST handler for manual triggers
export async function POST(request: Request) {
  const testNames = parseTestNames(request)
  // Test-before-batch protocol: ?names=… runs the resolver directly on the given
  // names (no deals/contacts sync) and returns the per-name resolution table.
  if (testNames) return runResolveTest(testNames)
  return runMondaySync()
}

// Resolver test harness — exercises resolveAndEnrichArtist on explicit names so the
// reuse-before-pay / tiebreak / enrich behavior can be verified before any backlog
// run. Does NOT depend on a matching unlinked Monday row.
async function runResolveTest(names: string[]) {
  const serviceClient = createServiceClient()
  let token: string
  try {
    token = await getCMToken()
  } catch {
    return NextResponse.json({ error: 'CM token failed' }, { status: 500 })
  }
  const roster = await fetchAllRows(serviceClient, 'intel_artists', 'chartmetric_id, name, spotify_followers, instagram_followers')
  const deps = {
    client: serviceClient,
    getToken: async () => token,
    existing: roster.map(r => ({ chartmetric_id: r.chartmetric_id, name: r.name, followers: Math.max(r.spotify_followers ?? 0, r.instagram_followers ?? 0) || null })),
    source: 'monday',
    discoveryStatus: 'pipeline',
  }
  const results = []
  for (const name of names) {
    await sleep(400)
    const r = await resolveAndEnrichArtist(name, deps)
    results.push({
      name,
      outcome: r.outcome,
      chartmetric_id: r.chartmetric_id,
      row_created: r.rowCreated,
      ...(r.reasons ? { reasons: r.reasons } : {}),
      ...(r.note ? { note: r.note } : {}),
      ...(r.error ? { error: r.error } : {}),
    })
  }
  return NextResponse.json({ test: true, count: results.length, results })
}

async function runMondaySync() {
  try {
    console.log('Starting Monday sync...')

    const deals = await syncDeals()
    console.log('Deals sync complete:', { total: deals.total, upserted: deals.upserted })

    // Auto-link unlinked Monday items to existing intel_artists by name (case-insensitive)
    const autoLinked = await autoLinkByName()
    console.log('Auto-link complete:', autoLinked)

    // Resolve + enrich brand-new Monday artists (reuse-before-pay, then CM) and link.
    const search = await searchAndLinkNewArtists()
    console.log('CM name search complete:', JSON.stringify(search))

    // Contacts run after linking so newly linked artists get contacts in the same run
    const contacts = await syncContacts(deals.items)
    console.log('Contacts sync complete:', contacts)

    // Backfill any items linked-but-not-yet-enriched (e.g. autoLinkByName matches).
    const enrichment = await enrichNewArtists()
    console.log('Enrichment complete:', enrichment)

    return NextResponse.json({
      success: true,
      deals,
      autoLinked,
      search,
      contacts,
      enrichment,
    })
  } catch (err: any) {
    console.error('Monday sync failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}