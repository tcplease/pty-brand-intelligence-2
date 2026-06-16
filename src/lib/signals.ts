// ── Signal resurface logic ───────────────────────────
// When a new signal fires (album-release / festival), decide whether an artist
// that's no longer actively in the pipeline should reappear on Radar. The
// signal is the REQUIRED trigger; the per-stage rules below are eligibility
// gates on top of it — never standalone recyclers of stale deals.

import type { SupabaseClient } from '@supabase/supabase-js'

const WON = 'Won (Final On-Sale Planned)'
const LOST = 'Lost'
const FELL_OFF = 'Fell Off (Not Lost)'

// Stages where the artist is actively being worked → already visible in the
// pipeline, so never pull them onto Radar.
const ACTIVE_STAGES = new Set([
  'Outbound - No Contact',
  'Outbound - Automated Contact',
  'Prospect - Direct Sales Agent Contact',
  'Active Leads (Contact Has Responded)',
  'Proposal (financials submitted)',
  'Negotiation (Terms Being Discussed)',
  'Finalizing On-Sale (Terms Agreed)',
])

const STALE_MONTHS = 6

interface DealRow {
  stage: string | null
  last_show: string | null
  deal_creation_date: string | null
}

/**
 * Call this after inserting a new album-release / festival activity_log signal.
 * Resurfaces (discovery_status='resurfaced') when, ON TOP OF that signal:
 *   • Won  — the signal date is after a completed tour's last_show (new cycle).
 *            Won deals with a future last_show are an active tour → excluded.
 *   • Lost / Fell Off (Not Lost) — the deal is stale (entered > 6 months ago).
 *   • dismissed pure-discovery artist (no Monday deals) — any signal revives it.
 * Artists with any active-pipeline deal are left alone (already visible).
 * `signalDate` is the release/festival date (ISO); required for the Won rule.
 *
 * Entered-stage date for the staleness gate uses `deal_creation_date`: the
 * `activity_log` "Deal stage: …" entries are a one-time 2026-03-18 backfill
 * (no live transition writer exists), so they are not reliable transition
 * dates. `deal_creation_date` is 100% populated on Lost/Fell-Off deals.
 */
export async function resurfaceIfHidden(
  supabase: SupabaseClient,
  chartmetricId: number,
  signalType: string,
  signalDate: string | null = null
): Promise<boolean> {
  const { data: artist } = await supabase
    .from('intel_artists')
    .select('discovery_status')
    .eq('chartmetric_id', chartmetricId)
    .single()

  if (!artist) return false
  if (artist.discovery_status === 'resurfaced') return false // already on Radar

  const { data: deals } = await supabase
    .from('intel_monday_items')
    .select('stage, last_show, deal_creation_date')
    .eq('chartmetric_id', chartmetricId)

  const now = new Date()
  const staleCutoff = new Date(now)
  staleCutoff.setMonth(staleCutoff.getMonth() - STALE_MONTHS)
  const sig = signalDate ? new Date(signalDate) : null

  let eligible = false
  let reason = ''

  if (deals && deals.length > 0) {
    // Any active-pipeline deal (incl. a Won deal whose tour hasn't finished) →
    // the artist is already worked/visible; do not resurface.
    const hasActive = (deals as DealRow[]).some(d => {
      if (d.stage && ACTIVE_STAGES.has(d.stage)) return true
      if (d.stage === WON && d.last_show && new Date(d.last_show) >= now) return true
      return false
    })

    if (!hasActive) {
      for (const d of deals as DealRow[]) {
        if (d.stage === WON) {
          // New cycle: a release/festival dated after the completed tour
          if (d.last_show && sig && sig > new Date(d.last_show)) {
            eligible = true
            reason = 'won_new_cycle'
            break
          }
        } else if (d.stage === LOST || d.stage === FELL_OFF) {
          if (d.deal_creation_date && new Date(d.deal_creation_date) < staleCutoff) {
            eligible = true
            reason = d.stage === LOST ? 'lost_stale' : 'fell_off_stale'
            break
          }
        }
      }
    }
  } else if (artist.discovery_status === 'dismissed') {
    // Pure-discovery artist (no Monday deal) that was dismissed — any signal revives.
    eligible = true
    reason = 'dismissed'
  }

  if (!eligible) return false

  // Resurface to the dedicated 'resurfaced' status (NOT 'new'). Monday-sourced
  // artists are source 'monday'/'both', which fail the discovery query's source
  // filter; the query admits discovery_status='resurfaced' regardless of source.
  // Leave `source` untouched. discovery_status only — never touch CM fields.
  await supabase
    .from('intel_artists')
    .update({ discovery_status: 'resurfaced' })
    .eq('chartmetric_id', chartmetricId)

  await supabase.from('activity_log').insert({
    chartmetric_id: chartmetricId,
    event_type: 'stage_change',
    event_title: `Resurfaced by ${signalType} signal`,
    event_detail: {
      action: 'resurfaced',
      reason,
      trigger: signalType,
      signal_date: signalDate ?? null,
    },
    event_date: new Date().toISOString().split('T')[0],
  })

  console.log(`  🔔 Resurfaced artist ${chartmetricId} (${reason}, triggered by ${signalType})`)
  return true
}
