import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const maxDuration = 60

// Weekly enrichment data-health check.
//
// Purpose: turn "a silent enrichment regression goes unnoticed for weeks" (the
// May 2026 null-demographics incident) into "flagged the next Monday." Two
// independent signals:
//
//  1. Canary assertion — a fixed set of known-full superstars that must ALWAYS
//     have every key field populated. If any canary field is null, something
//     broke; alert loudly. This catches a regression the same week.
//  2. Null-rate among the "should-have-data" cohort (Instagram ≥ 10k). The
//     long-tail of tiny acts legitimately has no audience data, so a table-wide
//     null-rate is noisy; restricting to IG ≥ 10k gives a low-noise threshold.
//
// Runs via the weekly Monday cron. Posts to Slack when SLACK_WEBHOOK_URL is set.

// Known-full superstars. The first five are the artists fixed in the June 2026
// re-refresh; the rest were already fully populated. All must stay non-null.
const CANARY_IDS: { id: number; name: string }[] = [
  { id: 3963, name: 'Ariana Grande' },
  { id: 206557, name: 'BTS' },
  { id: 3501, name: 'Bruno Mars' },
  { id: 558681, name: 'Harry Styles' },
  { id: 29, name: 'Metallica' },
  { id: 3907, name: 'Marshmello' },
  { id: 4495, name: 'Lorde' },
  { id: 1964, name: 'Diplo' },
]

// Fields every canary must have, and that we track null-rates for.
const KEY_FIELDS = [
  'spotify_monthly_listeners',
  'audience_male_pct',
  'age_25_34_pct',
  'audience_ethnicity',
  'top_countries',
] as const

// Null-rate within the IG ≥ 10k cohort above this fraction flags the field.
const NULL_RATE_THRESHOLD = 0.15
const IG_COHORT_MIN = 10000

async function countNull(
  sb: ReturnType<typeof createServiceClient>,
  field: string,
  igCohortOnly: boolean
): Promise<{ nullCount: number; total: number }> {
  let totalQ = sb.from('intel_artists').select('*', { count: 'exact', head: true }).not('cm_last_refreshed_at', 'is', null)
  let nullQ = sb.from('intel_artists').select('*', { count: 'exact', head: true }).not('cm_last_refreshed_at', 'is', null).is(field, null)
  if (igCohortOnly) {
    totalQ = totalQ.gte('instagram_followers', IG_COHORT_MIN)
    nullQ = nullQ.gte('instagram_followers', IG_COHORT_MIN)
  }
  const [{ count: total }, { count: nullCount }] = await Promise.all([totalQ, nullQ])
  return { nullCount: nullCount ?? 0, total: total ?? 0 }
}

async function runHealthCheck() {
  const sb = createServiceClient()

  // ── Canary assertion ──
  const { data: canaryRows, error: canaryErr } = await sb
    .from('intel_artists')
    .select(`chartmetric_id, name, ${KEY_FIELDS.join(', ')}`)
    .in('chartmetric_id', CANARY_IDS.map(c => c.id))
  if (canaryErr) throw new Error(`Canary query failed: ${canaryErr.message}`)

  const canaryFailures: { name: string; missing: string[] }[] = []
  for (const canary of CANARY_IDS) {
    const row: any = (canaryRows || []).find((r: any) => r.chartmetric_id === canary.id)
    if (!row) {
      canaryFailures.push({ name: canary.name, missing: ['ROW MISSING'] })
      continue
    }
    const missing = KEY_FIELDS.filter(f => row[f] === null || row[f] === undefined)
    if (missing.length) canaryFailures.push({ name: canary.name, missing })
  }

  // ── Null-rates (overall reporting + IG-cohort alarming) ──
  const fieldHealth: Record<string, {
    overall_null: number
    overall_total: number
    overall_pct: number
    cohort_null: number
    cohort_total: number
    cohort_pct: number
    flagged: boolean
  }> = {}

  for (const field of KEY_FIELDS) {
    const overall = await countNull(sb, field, false)
    const cohort = await countNull(sb, field, true)
    const cohortPct = cohort.total ? cohort.nullCount / cohort.total : 0
    fieldHealth[field] = {
      overall_null: overall.nullCount,
      overall_total: overall.total,
      overall_pct: overall.total ? Math.round((overall.nullCount / overall.total) * 1000) / 10 : 0,
      cohort_null: cohort.nullCount,
      cohort_total: cohort.total,
      cohort_pct: Math.round(cohortPct * 1000) / 10,
      flagged: cohortPct > NULL_RATE_THRESHOLD,
    }
  }

  const flaggedFields = Object.entries(fieldHealth).filter(([, v]) => v.flagged).map(([k]) => k)
  const healthy = canaryFailures.length === 0 && flaggedFields.length === 0

  return { healthy, canaryFailures, fieldHealth, flaggedFields }
}

function buildSlackMessage(result: Awaited<ReturnType<typeof runHealthCheck>>): string {
  const { healthy, canaryFailures, fieldHealth, flaggedFields } = result
  const lines: string[] = []
  lines.push(healthy
    ? ':white_check_mark: *Enrichment data-health: OK*'
    : ':rotating_light: *Enrichment data-health: ATTENTION NEEDED*')

  if (canaryFailures.length) {
    lines.push(`*Canary failures (${canaryFailures.length}):* known-full artists missing data —`)
    for (const f of canaryFailures) lines.push(`  • ${f.name}: ${f.missing.join(', ')}`)
  }

  lines.push('*Null-rate (IG ≥ 10k cohort | all refreshed):*')
  for (const field of KEY_FIELDS) {
    const h = fieldHealth[field]
    const flag = h.flagged ? ' :warning:' : ''
    lines.push(`  • ${field}: ${h.cohort_pct}% (${h.cohort_null}/${h.cohort_total}) | ${h.overall_pct}% all${flag}`)
  }
  if (flaggedFields.length) {
    lines.push(`:warning: Above ${NULL_RATE_THRESHOLD * 100}% in the IG≥10k cohort: ${flaggedFields.join(', ')}`)
  }
  return lines.join('\n')
}

async function postToSlack(text: string) {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return false
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function GET(request: Request) {
  // Cron auth (same pattern as other sync routes). Allow unauthenticated only
  // when no CRON_SECRET is configured (local dev).
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runHealthCheck()
    const slackText = buildSlackMessage(result)
    const slackPosted = await postToSlack(slackText)

    if (!result.healthy) {
      console.error('[DATA HEALTH] Issues detected:', JSON.stringify({
        canaryFailures: result.canaryFailures,
        flaggedFields: result.flaggedFields,
      }))
    }

    // 200 always (cron success); the `healthy` flag carries the verdict.
    return NextResponse.json({ ...result, slack_posted: slackPosted })
  } catch (err: any) {
    console.error('[DATA HEALTH] check failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
