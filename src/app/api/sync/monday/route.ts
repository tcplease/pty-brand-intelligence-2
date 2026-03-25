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

// ── Main handler ──────────────────────────────────────
export async function POST() {
  try {
    console.log('Starting Monday sync...')

    const deals = await syncDeals()
    console.log('Deals sync complete:', { total: deals.total, upserted: deals.upserted })

    const contacts = await syncContacts(deals.items)
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