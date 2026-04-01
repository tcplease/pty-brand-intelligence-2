// ── Signal resurface logic ───────────────────────────
// When a new signal fires (festival, pre-save, album cycle),
// check if the artist was previously dismissed or lost.
// If so, resurface them back to discovery so the team sees them again.

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Call this after inserting a new activity_log signal.
 * If the artist is dismissed or tied to a Lost deal, resurface them
 * to discovery_status = 'new' so they reappear on Radar.
 */
export async function resurfaceIfHidden(
  supabase: SupabaseClient,
  chartmetricId: number,
  signalType: string
): Promise<boolean> {
  // Check current state
  const { data: artist } = await supabase
    .from('intel_artists')
    .select('discovery_status')
    .eq('chartmetric_id', chartmetricId)
    .single()

  if (!artist) return false

  const isDismissed = artist.discovery_status === 'dismissed'

  // Check if artist only has Lost deals (no active pipeline deals)
  const { data: mondayItems } = await supabase
    .from('intel_monday_items')
    .select('stage')
    .eq('chartmetric_id', chartmetricId)

  const hasActiveDeal = mondayItems?.some(
    (m: { stage: string | null }) => m.stage && m.stage !== 'Lost'
  )
  const isLostOnly = mondayItems && mondayItems.length > 0 && !hasActiveDeal

  if (!isDismissed && !isLostOnly) return false

  // Resurface: set discovery_status back to 'new'
  await supabase
    .from('intel_artists')
    .update({ discovery_status: 'new' })
    .eq('chartmetric_id', chartmetricId)

  // Log the resurface event
  await supabase.from('activity_log').insert({
    chartmetric_id: chartmetricId,
    event_type: 'stage_change',
    event_title: `Resurfaced by ${signalType} signal`,
    event_detail: {
      action: 'resurfaced',
      previous_status: isDismissed ? 'dismissed' : 'lost_only',
      trigger: signalType,
    },
    event_date: new Date().toISOString().split('T')[0],
  })

  console.log(`  🔔 Resurfaced artist ${chartmetricId} (was ${isDismissed ? 'dismissed' : 'lost'}, triggered by ${signalType})`)
  return true
}
