import { createServiceClient } from '@/lib/supabase'

// ── Stage handling (shared by Match grid + report) ──────────────────
export const HIDDEN_STAGES = ['Lost', 'Tour Canceled', 'Fell Off (Not Lost)']

const STAGE_PRIORITY: Record<string, number> = {
  'Lost': 0, 'Tour Canceled': 1, 'Fell Off (Not Lost)': 2,
  'Outbound - No Contact': 3, 'Outbound - Automated Contact': 4,
  'Prospect - Direct Sales Agent Contact': 5,
  'Active Leads (Contact Has Responded)': 6,
  'Proposal (financials submitted)': 7,
  'Negotiation (Terms Being Discussed)': 8,
  'Finalizing On-Sale (Terms Agreed)': 9,
  'Won (Final On-Sale Planned)': 10,
}
function stagePriority(stage: string | null): number {
  return stage ? (STAGE_PRIORITY[stage] ?? -1) : -1
}

const AGE_FIELD_MAP: Record<string, string> = {
  '13-17': 'age_13_17_pct',
  '18-24': 'age_18_24_pct',
  '25-34': 'age_25_34_pct',
  '35-44': 'age_35_44_pct',
  '45-64': 'age_45_64_pct',
  '65+':   'age_65_plus_pct',
}

// ── Types ───────────────────────────────────────────────────────────
interface ArtistRow {
  chartmetric_id: number
  name: string
  image_url: string | null
  career_stage: string | null
  cm_score: number | null
  primary_genre: string | null
  spotify_followers: number | null
  instagram_followers: number | null
  tiktok_followers: number | null
  audience_male_pct: number | null
  audience_female_pct: number | null
  age_13_17_pct: number | null
  age_18_24_pct: number | null
  age_25_34_pct: number | null
  age_35_44_pct: number | null
  age_45_64_pct: number | null
  age_65_plus_pct: number | null
}

export interface BrandSearchResult extends ArtistRow {
  demographic_pct: number
  affinity_score: number
  combined_score: number
  deal_stage: string | null
  first_show: string | null
  // Sector multi-select match info (0 when no sectors selected / not matched)
  sector_match_count: number
  sector_avg_affinity: number
  sector_max_affinity: number
}

export interface BrandSearchParams {
  brand?: string
  sector?: string
  gender?: string // 'male' | 'female' | 'any'
  threshold?: number
  ages?: string[]
  sectorNames?: string[]
  sectorLogic?: 'any' | 'all' // ANY = ≥1 selected sector; ALL = every selected sector
}

// ── Core scoring (deterministic: pure math on stored fields) ─────────
// The only time-dependent input is `today`, used to drop expired deals
// (last_show < today) — not part of the demo/affinity score itself.
export async function runBrandSearch(params: BrandSearchParams): Promise<BrandSearchResult[]> {
  // Server-only. Instantiate the service_role client here (not at module scope) since
  // this lib is broadly importable — keeps the service key out of any shared singleton.
  const supabase = createServiceClient()
  const brand = params.brand || ''
  const sector = params.sector || ''
  const gender = params.gender || 'any'
  const threshold = params.threshold ?? 0
  const ages = params.ages ?? []

  // 1. All pipeline artists with refreshed CM data
  const { data: artists, error: artistError } = await supabase
    .from('intel_artists')
    .select(`
      chartmetric_id, name, image_url, career_stage, cm_score,
      primary_genre, spotify_followers, instagram_followers, tiktok_followers,
      audience_male_pct, audience_female_pct,
      age_13_17_pct, age_18_24_pct, age_25_34_pct,
      age_35_44_pct, age_45_64_pct, age_65_plus_pct
    `)
    .eq('discovery_status', 'pipeline')
    .not('cm_last_refreshed_at', 'is', null)

  if (artistError) throw artistError

  // 1b. Active deal stage per artist from Monday items
  const { data: mondayStages } = await supabase
    .from('intel_monday_items')
    .select('chartmetric_id, stage, last_show, first_show')
    .not('chartmetric_id', 'is', null)

  const today = new Date().toISOString().split('T')[0]
  const dealStageMap = new Map<number, string | null>()
  const firstShowMap = new Map<number, string | null>()
  for (const item of mondayStages || []) {
    const id = item.chartmetric_id as number
    const stage = item.stage as string | null
    const lastShow = item.last_show as string | null
    const firstShow = (item as Record<string, unknown>).first_show as string | null
    const isHiddenStage = stage === null || HIDDEN_STAGES.includes(stage)
    const isExpired = lastShow != null && lastShow < today
    if (isHiddenStage || isExpired) continue
    const existing = dealStageMap.get(id)
    if (!existing || stagePriority(stage) > stagePriority(existing)) {
      dealStageMap.set(id, stage)
      firstShowMap.set(id, firstShow)
    }
  }

  // 2. Brand/sector affinity (max scale per artist)
  const affinityMap = new Map<number, number>()
  if (brand) {
    const { data: brandData } = await supabase
      .from('intel_brand_affinities')
      .select('chartmetric_id, affinity_scale')
      .ilike('brand_name', `%${brand}%`)
      .gte('affinity_scale', 1.0)
    for (const row of brandData || []) {
      const existing = affinityMap.get(row.chartmetric_id) || 0
      if (row.affinity_scale > existing) affinityMap.set(row.chartmetric_id, row.affinity_scale)
    }

    const { data: sectorData } = await supabase
      .from('intel_sector_affinities')
      .select('chartmetric_id, affinity_scale')
      .ilike('sector_name', `%${brand}%`)
      .gte('affinity_scale', 1.0)
    for (const row of sectorData || []) {
      const existing = affinityMap.get(row.chartmetric_id) || 0
      if (row.affinity_scale > existing) affinityMap.set(row.chartmetric_id, row.affinity_scale)
    }
  }

  // 2b. Sector multi-select (ANY / ALL) — match on sector_NAME (the real identity;
  // sector_id is a per-artist rank index, not a sector key). Presence of a row in
  // intel_sector_affinities IS the ranking (every stored row is >= 1.0x). Hard filter
  // that ANDs with all other filters; does NOT use the brand `affinity` path above.
  // Per-artist {count of DISTINCT matched sector_names, avg, max} drives ordering.
  const sectorNames = (params.sectorNames ?? []).filter((n) => typeof n === 'string' && n.trim())
  const sectorLogic = params.sectorLogic === 'all' ? 'all' : 'any'
  let sectorMatch: Map<number, { count: number; avg: number; max: number }> | null = null
  if (sectorNames.length > 0) {
    const { data: secRows, error: secErr } = await supabase
      .from('intel_sector_affinities')
      .select('chartmetric_id, sector_name, affinity_scale')
      .in('sector_name', sectorNames)
    if (secErr) throw secErr
    const acc = new Map<number, { names: Set<string>; sum: number; max: number }>()
    for (const row of secRows || []) {
      const e = acc.get(row.chartmetric_id) || { names: new Set<string>(), sum: 0, max: 0 }
      if (!e.names.has(row.sector_name)) {
        e.names.add(row.sector_name)
        e.sum += row.affinity_scale
        if (row.affinity_scale > e.max) e.max = row.affinity_scale
      }
      acc.set(row.chartmetric_id, e)
    }
    sectorMatch = new Map()
    const need = sectorNames.length
    for (const [id, e] of acc) {
      const count = e.names.size
      // ANY → at least one; ALL → every selected sector_name (COUNT DISTINCT = N)
      const qualifies = sectorLogic === 'all' ? count === need : count >= 1
      if (qualifies) sectorMatch.set(id, { count, avg: e.sum / count, max: e.max })
    }
  }

  // 3. Score
  const hasBrandFilter = !!(brand || sector)
  const results: BrandSearchResult[] = (artists || []).map((artist: ArtistRow) => {
    let totalAgePct = 0
    if (ages.length > 0) {
      for (const age of ages) {
        const field = AGE_FIELD_MAP[age]
        // dynamic age-band lookup — field name comes from a fixed whitelist
        if (field) totalAgePct += (artist as unknown as Record<string, number | null>)[field] || 0
      }
    } else {
      totalAgePct = 100
    }

    let demographicPct = totalAgePct
    if (gender === 'female') {
      demographicPct = totalAgePct * ((artist.audience_female_pct || 50) / 100)
    } else if (gender === 'male') {
      demographicPct = totalAgePct * ((artist.audience_male_pct || 50) / 100)
    }

    const affinityScore = affinityMap.get(artist.chartmetric_id) || 0
    const normalizedAffinity = Math.min((affinityScore / 4) * 100, 100) // 4x = max expected
    const combinedScore = hasBrandFilter
      ? (demographicPct * 0.6) + (normalizedAffinity * 0.4)
      : demographicPct

    const sm = sectorMatch?.get(artist.chartmetric_id)
    return {
      ...artist,
      demographic_pct: Math.round(demographicPct * 10) / 10,
      affinity_score: affinityScore,
      combined_score: Math.round(combinedScore * 10) / 10,
      deal_stage: dealStageMap.get(artist.chartmetric_id) ?? null,
      first_show: firstShowMap.get(artist.chartmetric_id) ?? null,
      sector_match_count: sm?.count ?? 0,
      sector_avg_affinity: sm ? Math.round(sm.avg * 10) / 10 : 0,
      sector_max_affinity: sm ? Math.round(sm.max * 10) / 10 : 0,
    }
  })
  .filter((a) => {
    if (!a.deal_stage) return false
    if (ages.length > 0 || gender !== 'any') {
      if (a.demographic_pct < threshold) return false
    }
    if (hasBrandFilter && a.affinity_score === 0) return false
    if (ages.length > 0 && a.age_18_24_pct === null) return false
    // Sector multi-select filter — AND with everything else.
    if (sectorMatch && !sectorMatch.has(a.chartmetric_id)) return false
    return true
  })
  .sort((a, b) => {
    // When sectors are selected, order by the sector fit first (ALL → strongest
    // all-round avg; ANY → most matched sectors, then strongest single). Falls back
    // to the existing brand/demographic combined_score as the tiebreaker.
    if (sectorMatch) {
      if (sectorLogic === 'all') {
        if (b.sector_avg_affinity !== a.sector_avg_affinity) return b.sector_avg_affinity - a.sector_avg_affinity
      } else {
        if (b.sector_match_count !== a.sector_match_count) return b.sector_match_count - a.sector_match_count
        if (b.sector_max_affinity !== a.sector_max_affinity) return b.sector_max_affinity - a.sector_max_affinity
      }
    }
    return b.combined_score - a.combined_score
  })
  .slice(0, 100)

  return results
}
