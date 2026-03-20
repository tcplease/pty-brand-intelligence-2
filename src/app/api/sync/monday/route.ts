import { NextResponse } from 'next/server'
import { supabase, createServiceClient } from '@/lib/supabase'

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
function parseColumnValue(colId: string, text: string | null, value: string | null) {
  if (!text && !value) return null

  if (NUMBER_COLS.has(colId)) {
    const num = parseFloat(text || '')
    return isNaN(num) ? null : num
  }

  if (DATE_COLS.has(colId)) {
    if (value) {
      try {
        const parsed = JSON.parse(value)
        if (parsed.date) return parsed.date
      } catch {}
    }
    if (text && /^\d{4}-\d{2}-\d{2}/.test(text)) {
      return text.split('T')[0]
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
    const cursorArg = cursor ? `, cursor: "${cursor}"` : ''
    const query = `{
      boards(ids: ${boardId}) {
        items_page(limit: 100${cursorArg}) {
          cursor
          items {
            id
            name
            ${extraFields}
            column_values { id type text value }
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
        row[supaCol] = parseColumnValue(col.id, col.text, col.value)
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

  return { total: items.length, upserted }
}

// ── Step 2: Sync contacts from CRM ───────────────────
async function syncContacts() {
  const serviceClient = createServiceClient()

  // Fetch all CRM contacts
  const contacts = await fetchAllBoardItems(CRM_BOARD_ID)
  console.log(`Total CRM contacts: ${contacts.length}`)

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

  console.log(`Deal→artist mappings: ${dealIdToCmId.size}`)

  const toInsert: any[] = []
  let skipped = 0

  for (const contact of contacts) {
    const cols = contact.column_values || []
    const name = contact.name || null
    const email = getColText(cols, 'email')
    const phone = getColText(cols, 'phone')
    const typeText = getColText(cols, 'status')

    // Determine role from which deal relation column has linked items
    const managerDealIds = getLinkedItemIds(cols, 'link_to___deals')
    const agentDealIds = getLinkedItemIds(cols, 'link_to_events_deals_mkkbg5x5')
    const bizDealIds = getLinkedItemIds(cols, 'connect_boards_mkkbkjg7')

    let role: 'manager' | 'agent' | 'business_manager' = 'manager'
    let dealIds = managerDealIds

    if (agentDealIds.length > 0) {
      role = 'agent'
      dealIds = agentDealIds
    } else if (bizDealIds.length > 0) {
      role = 'business_manager'
      dealIds = bizDealIds
    } else if (managerDealIds.length > 0) {
      role = 'manager'
      dealIds = managerDealIds
    } else if (typeText) {
      // Fall back to Type field if no deal links
      const t = typeText.toLowerCase()
      if (t.includes('agent') || t.includes('agency')) role = 'agent'
      else if (t.includes('biz') || t.includes('business')) role = 'business_manager'
      // No deal links = can't match to an artist
      skipped++
      continue
    } else {
      skipped++
      continue
    }

    // Find chartmetric IDs from linked deals
    const chartmetricIds = new Set<number>()
    for (const dealId of dealIds) {
      const cmId = dealIdToCmId.get(dealId)
      if (cmId) chartmetricIds.add(cmId)
    }

    if (chartmetricIds.size === 0) {
      skipped++
      continue
    }

    for (const chartmetricId of chartmetricIds) {
      toInsert.push({
        chartmetric_id: chartmetricId,
        role,
        contact_name: name,
        company_name: null, // Company is a board_relation — not available via simple column read
        email,
        phone,
        linkedin_url: null,
        source: 'monday',
        last_verified_at: new Date().toISOString(),
      })
    }
  }

  console.log(`Contacts to insert: ${toInsert.length}, skipped: ${skipped}`)

  if (toInsert.length === 0) {
    return { total: contacts.length, skipped, upserted: 0 }
  }

  // Clear existing Monday contacts and re-insert
  const { error: deleteError } = await serviceClient
    .from('intel_artist_contacts')
    .delete()
    .eq('source', 'monday')

  if (deleteError) throw deleteError

  const BATCH = 200
  let upserted = 0

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH)
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
  return { total: contacts.length, skipped, upserted }
}

// ── Main handler ──────────────────────────────────────
export async function POST() {
  try {
    console.log('Starting Monday sync...')

    const deals = await syncDeals()
    console.log('Deals sync complete:', deals)

    const contacts = await syncContacts()
    console.log('Contacts sync complete:', contacts)

    return NextResponse.json({
      success: true,
      deals,
      contacts,
    })
  } catch (err: any) {
    console.error('Monday sync failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}