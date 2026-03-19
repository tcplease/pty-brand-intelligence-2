import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const BOARD_ID = '2696356409'

// Monday column ID → Supabase column mapping
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

// Columns that hold numeric values
const NUMBER_COLS = new Set(['numbers0', 'numbers__1', 'numbers02', 'numbers'])

// Columns that hold date values (mirrors + native date)
const DATE_COLS = new Set(['mirror6', 'mirror23', 'mirror21', 'mirror20', 'mirror16', 'date1'])

// Columns where we just grab .text as a string
const TEXT_COLS = new Set(['text__1', 'person', 'status', 'tags6', 'priority'])

function parseColumnValue(colId: string, text: string | null, value: string | null) {
  // Empty / null
  if (!text && !value) return null

  if (NUMBER_COLS.has(colId)) {
    const num = parseFloat(text || '')
    return isNaN(num) ? null : num
  }

  if (DATE_COLS.has(colId)) {
    // Native date columns store date in value JSON
    if (value) {
      try {
        const parsed = JSON.parse(value)
        if (parsed.date) return parsed.date // "2026-02-24"
      } catch {}
    }
    // Mirror date columns sometimes put the date in .text
    if (text && /^\d{4}-\d{2}-\d{2}/.test(text)) {
      return text.split('T')[0] // just the date part
    }
    return null
  }

  if (TEXT_COLS.has(colId)) {
    return text || null
  }

  return text || null
}

async function fetchAllItems() {
  const allItems: any[] = []
  let cursor: string | null = null

  // Monday paginates at 100 items per page
  do {
    const cursorArg = cursor ? `, cursor: "${cursor}"` : ''
    const query = `{
      boards(ids: ${BOARD_ID}) {
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

    if (json.errors) {
      throw new Error(`Monday API error: ${JSON.stringify(json.errors)}`)
    }

    const page = json.data.boards[0].items_page
    allItems.push(...page.items)
    cursor = page.cursor || null

    console.log(`Fetched ${allItems.length} items so far...`)
  } while (cursor)

  return allItems
}

export async function POST() {
  try {
    console.log('Starting Monday sync...')
    const items = await fetchAllItems()
    console.log(`Total items from Monday: ${items.length}`)

    // Transform each item into a Supabase row
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

    // Upsert in batches of 200 to avoid timeouts
    const BATCH_SIZE = 200
    let upserted = 0

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase
        .from('intel_monday_items')
        .upsert(batch, { onConflict: 'monday_item_id' })

      if (error) {
        console.error(`Batch error at index ${i}:`, error.message)
        return NextResponse.json(
          { error: error.message, batch_start: i },
          { status: 500 }
        )
      }
      upserted += batch.length
      console.log(`Upserted ${upserted}/${rows.length}`)
    }

    return NextResponse.json({
      success: true,
      total_from_monday: items.length,
      upserted,
    })
  } catch (err: any) {
    console.error('Monday sync failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}