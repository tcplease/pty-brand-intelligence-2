import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCMToken, cmSearchArtists, insertEnrichedArtist } from '@/lib/chartmetric-enrich'

// Needs-review queue for the confidence floor. Items the resolver couldn't confidently
// auto-link (generic token, single-token &-split, low-similarity tiebreak) are stamped
// cm_search_result='ambiguous' on intel_monday_items and surfaced here for a human to
// link the right artist. READ-ONLY from Monday — linking only writes our own DB.

export const maxDuration = 120

// GET — list flagged (cm_search_result='ambiguous', still unlinked), grouped by name.
export async function GET() {
  try {
    const client = createServiceClient()
    const { data, error } = await client
      .from('intel_monday_items')
      .select('monday_item_id, artist_name, stage')
      .is('chartmetric_id', null)
      .eq('cm_search_result', 'ambiguous')
    if (error) throw new Error(error.message)

    interface Flag { name: string; deals: { monday_item_id: number; stage: string }[] }
    const byName = new Map<string, Flag>()
    for (const r of data ?? []) {
      const key = (r.artist_name || '').toLowerCase().trim()
      if (!key) continue
      const g: Flag = byName.get(key) || { name: r.artist_name, deals: [] }
      g.deals.push({ monday_item_id: r.monday_item_id, stage: r.stage })
      byName.set(key, g)
    }
    const items = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ count: items.length, items })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}

// POST — two actions:
//   { action:'candidates', name } → CM search (no insert), flag which already exist.
//   { action:'link', name, monday_item_ids, chartmetric_id, cm_name } → ensure the
//     artist row (enrich if new — human-confirmed, bypasses the floor), link the deals,
//     clear the flag.
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const client = createServiceClient()

    if (body.action === 'candidates') {
      const name = (body.name || '').trim()
      if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
      const token = await getCMToken()
      const candidates = await cmSearchArtists(name, token, 6)
      // flag which candidates we already hold
      const ids = candidates.map((c) => c.id)
      const existing = new Set<number>()
      if (ids.length) {
        const { data } = await client.from('intel_artists').select('chartmetric_id').in('chartmetric_id', ids)
        for (const a of data ?? []) existing.add(a.chartmetric_id)
      }
      return NextResponse.json({
        candidates: candidates.map((c) => ({ ...c, existsInDb: existing.has(c.id) })),
      })
    }

    if (body.action === 'link') {
      const monday_item_ids: number[] = body.monday_item_ids || []
      const chartmetric_id: number = body.chartmetric_id
      const cm_name: string = body.cm_name || ''
      if (!chartmetric_id || !monday_item_ids.length) {
        return NextResponse.json({ error: 'chartmetric_id and monday_item_ids required' }, { status: 400 })
      }

      // Ensure the artist row exists (enrich if new). Human-confirmed, so no floor.
      const { data: existing } = await client
        .from('intel_artists')
        .select('chartmetric_id')
        .eq('chartmetric_id', chartmetric_id)
        .maybeSingle()

      if (!existing) {
        const token = await getCMToken()
        const enrich = await insertEnrichedArtist(client, chartmetric_id, token, {
          source: 'monday',
          discovery_status: 'pipeline',
          fallbackName: cm_name,
        })
        if (enrich.error) {
          return NextResponse.json({ error: `enrichment failed: ${enrich.error}` }, { status: 502 })
        }
      } else {
        await client
          .from('intel_artists')
          .update({ discovery_status: 'pipeline', source: 'both' })
          .eq('chartmetric_id', chartmetric_id)
      }

      // Link the deals + clear the flag (only our DB — no Monday write-back).
      const { error: linkErr } = await client
        .from('intel_monday_items')
        .update({ chartmetric_id, cm_search_result: null })
        .in('monday_item_id', monday_item_ids)
      if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })

      return NextResponse.json({ success: true, linked: monday_item_ids.length, chartmetric_id })
    }

    return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}
