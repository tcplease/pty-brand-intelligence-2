import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const TOURS_BOARD_ID = '3979002729'

// Tours board column IDs for dates
const TOUR_DATE_COLS: Record<string, string> = {
  date: 'announce_date',
  date1: 'pre_sale_date',
  date17: 'on_sale_date',
  date0: 'first_show',
  date9: 'last_show',
}

async function fetchAllTourItems() {
  const allItems: any[] = []
  let cursor: string | null = null

  do {
    const cursorArg = cursor ? `, cursor: "${cursor}"` : ''
    const query = `{
      boards(ids: ${TOURS_BOARD_ID}) {
        items_page(limit: 100${cursorArg}) {
          cursor
          items {
            id
            name
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

    console.log(`Tours: fetched ${allItems.length} items so far...`)
  } while (cursor)

  return allItems
}

function parseDateValue(text: string | null, value: string | null): string | null {
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

export async function POST() {
  try {
    console.log('Starting Tours date sync...')

    // 1. Fetch all tour items from Monday
    const tourItems = await fetchAllTourItems()
    console.log(`Total tour items: ${tourItems.length}`)

    // 2. Build a map of artist name (lowercase) → dates
    //    Some artists may have multiple tour entries — we take the one
    //    with the latest last_show date
    const tourMap = new Map<string, Record<string, string | null>>()

    for (const item of tourItems) {
      const name = item.name.trim().toLowerCase()
      const dates: Record<string, string | null> = {}

      for (const col of item.column_values) {
        const supaCol = TOUR_DATE_COLS[col.id]
        if (supaCol) {
          dates[supaCol] = parseDateValue(col.text, col.value)
        }
      }

      // If we already have this artist, keep the entry with the later last_show
      const existing = tourMap.get(name)
      if (existing) {
        const existingLast = existing.last_show || '0000-00-00'
        const newLast = dates.last_show || '0000-00-00'
        if (newLast > existingLast) {
          tourMap.set(name, dates)
        }
      } else {
        tourMap.set(name, dates)
      }
    }

    console.log(`Unique tour artists: ${tourMap.size}`)

    // 3. Fetch all monday items from Supabase to match by name
    const { data: mondayItems, error: fetchError } = await supabase
      .from('intel_monday_items')
      .select('id, artist_name')

    if (fetchError) {
      throw new Error(`Supabase fetch error: ${fetchError.message}`)
    }

    // 4. Match and update
    let matched = 0
    let unmatched = 0
    const batchUpdates: { id: string; dates: Record<string, string | null> }[] = []

    for (const row of mondayItems || []) {
      const nameLower = row.artist_name.trim().toLowerCase()
      const dates = tourMap.get(nameLower)

      if (dates) {
        batchUpdates.push({ id: row.id, dates })
        matched++
      } else {
        unmatched++
      }
    }

    console.log(`Matched: ${matched}, Unmatched: ${unmatched}`)

    // 5. Update Supabase in batches
    let updated = 0
    for (const item of batchUpdates) {
      const { error } = await supabase
        .from('intel_monday_items')
        .update({
          announce_date: item.dates.announce_date,
          pre_sale_date: item.dates.pre_sale_date,
          on_sale_date: item.dates.on_sale_date,
          first_show: item.dates.first_show,
          last_show: item.dates.last_show,
        })
        .eq('id', item.id)

      if (error) {
        console.error(`Failed to update ${item.id}:`, error.message)
      } else {
        updated++
      }
    }

    console.log(`Updated ${updated} rows with tour dates`)

    return NextResponse.json({
      success: true,
      tour_items: tourItems.length,
      unique_artists: tourMap.size,
      matched,
      unmatched,
      updated,
    })
  } catch (err: any) {
    console.error('Tours sync failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}