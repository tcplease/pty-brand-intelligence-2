import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

const CRM_BOARD_ID = '2696356486'

// ── Monday API helpers (duplicated from sync/monday to keep this self-contained) ──

function getColText(columnValues: Record<string, unknown>[], id: string): string | null {
  const col = columnValues.find((c: Record<string, unknown>) => c.id === id)
  return (col?.text as string) || null
}

function getLinkedItemIds(columnValues: Record<string, unknown>[], id: string): string[] {
  const col = columnValues.find((c: Record<string, unknown>) => c.id === id)
  if (!col?.value) return []
  try {
    const parsed = JSON.parse(col.value as string)
    return (parsed?.linkedPulseIds || []).map((l: Record<string, unknown>) => String(l.linkedPulseId))
  } catch {
    return []
  }
}

async function fetchAllBoardItems(boardId: string): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = []
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
            group { title }
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
    console.log(`[CRM] Fetched ${allItems.length} items...`)
  } while (cursor)

  return allItems
}

// ── CRM board column IDs for role detection ──
const MANAGER_LINK = 'link_to___deals'
const AGENT_LINK = 'link_to_events_deals_mkkbg5x5'
const BIZ_MANAGER_LINK = 'connect_boards_mkkbkjg7'

interface ExportContact {
  contact_name: string | null
  email: string | null
  phone: string | null
  company_name: string | null
  role: string
  source: string
  synced_at: string
}

// ── Main sync logic ──

export async function POST() {
  try {
    const crmItems = await fetchAllBoardItems(CRM_BOARD_ID)
    console.log(`CRM board total items: ${crmItems.length}`)

    const now = new Date().toISOString()
    const contactMap = new Map<string, ExportContact>()

    for (const item of crmItems) {
      const name = (item.name as string) || null
      const cols = (item.column_values || []) as Record<string, unknown>[]
      const email = getColText(cols, 'email')
      const phone = getColText(cols, 'phone')

      // Determine role from linked board columns
      const managerLinks = getLinkedItemIds(cols, MANAGER_LINK)
      const agentLinks = getLinkedItemIds(cols, AGENT_LINK)
      const bizLinks = getLinkedItemIds(cols, BIZ_MANAGER_LINK)

      let role = 'unknown'
      if (managerLinks.length > 0) role = 'manager'
      else if (agentLinks.length > 0) role = 'agent'
      else if (bizLinks.length > 0) role = 'business_manager'
      else {
        // Fall back to group title if no deal links
        const groupTitle = ((item.group as Record<string, unknown>)?.title as string) || ''
        const gl = groupTitle.toLowerCase()
        if (gl.includes('manager') || gl.includes('mgmt')) role = 'manager'
        else if (gl.includes('agent') || gl.includes('agency')) role = 'agent'
        else if (gl.includes('business')) role = 'business_manager'
      }

      // Try to extract company from a company column if available
      const company = getColText(cols, 'text') || getColText(cols, 'company') || null

      // Dedupe key: email+role if email exists, otherwise name+role
      const dedupeKey = email
        ? `${email.toLowerCase()}|${role}`
        : name
          ? `${name.toLowerCase()}|${role}`
          : null

      if (!dedupeKey) continue // skip contacts with no name and no email

      if (!contactMap.has(dedupeKey)) {
        contactMap.set(dedupeKey, {
          contact_name: name,
          email,
          phone,
          company_name: company,
          role,
          source: 'monday',
          synced_at: now,
        })
      }
    }

    const contacts = Array.from(contactMap.values())
    console.log(`Deduplicated contacts: ${contacts.length}`)

    // Clear and re-insert
    const serviceClient = createServiceClient()

    const { error: deleteError } = await serviceClient
      .from('export_contacts')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000') // delete all rows

    if (deleteError) throw deleteError

    const BATCH = 200
    let inserted = 0
    for (let i = 0; i < contacts.length; i += BATCH) {
      const batch = contacts.slice(i, i + BATCH)
      const { error } = await serviceClient.from('export_contacts').insert(batch)
      if (error) {
        console.error(`Batch error at ${i}:`, error.message)
      } else {
        inserted += batch.length
      }
    }

    console.log(`Export contacts synced: ${inserted}/${contacts.length}`)

    return NextResponse.json({
      total: contacts.length,
      synced: inserted,
      synced_at: now,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Sync export contacts failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
