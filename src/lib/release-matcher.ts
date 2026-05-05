// ── Match raw artist names from release-calendar scrapers to intel_artists ──
// Priority:
//   1. Exact alias hit (artist_aliases.alias)
//   2. Exact name hit (intel_artists.name, case-insensitive)
//   3. Unmatched

import type { SupabaseClient } from '@supabase/supabase-js'

export interface MatcherIndex {
  byName: Map<string, number>      // normalized name → chartmetric_id
  byAlias: Map<string, number>     // normalized alias → chartmetric_id
}

export interface MatchResult {
  chartmetric_id: number | null
  via: 'alias' | 'exact' | null
}

/** Lowercase, strip accents, trim, collapse whitespace. Featuring artists removed. */
export function normalizeName(name: string): string {
  if (!name) return ''
  let s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritics
    .toLowerCase()
    .trim()
  // Remove "feat./ft./featuring X" tails
  s = s.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '')
  // Remove parenthetical qualifiers ("(deluxe)", "(live)", etc.)
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ')
  // Collapse whitespace, strip non-alpha-num boundary punct
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^[\s,.;:]+|[\s,.;:]+$/g, '')
  return s
}

/** Pre-load all artists + aliases into in-memory maps for O(1) lookup. */
export async function buildMatcherIndex(supabase: SupabaseClient): Promise<MatcherIndex> {
  const byName = new Map<string, number>()
  const byAlias = new Map<string, number>()

  // intel_artists.name → chartmetric_id (only active discovery rows + pipeline)
  const { data: artists, error: artistErr } = await supabase
    .from('intel_artists')
    .select('chartmetric_id, name')
  if (artistErr) throw new Error(`buildMatcherIndex artists: ${artistErr.message}`)
  for (const a of artists ?? []) {
    if (!a.name || a.chartmetric_id == null) continue
    const norm = normalizeName(a.name)
    if (!norm) continue
    // First write wins — collisions on normalized name are rare but real
    if (!byName.has(norm)) byName.set(norm, a.chartmetric_id)
  }

  const { data: aliases, error: aliasErr } = await supabase
    .from('artist_aliases')
    .select('alias, chartmetric_id')
  if (aliasErr) throw new Error(`buildMatcherIndex aliases: ${aliasErr.message}`)
  for (const a of aliases ?? []) {
    if (!a.alias || a.chartmetric_id == null) continue
    byAlias.set(a.alias.toLowerCase().trim(), a.chartmetric_id)
  }

  return { byName, byAlias }
}

/** Match one raw name against the pre-built index. */
export function matchName(rawName: string, index: MatcherIndex): MatchResult {
  const norm = normalizeName(rawName)
  if (!norm) return { chartmetric_id: null, via: null }
  const aliasHit = index.byAlias.get(norm)
  if (aliasHit != null) return { chartmetric_id: aliasHit, via: 'alias' }
  const nameHit = index.byName.get(norm)
  if (nameHit != null) return { chartmetric_id: nameHit, via: 'exact' }
  return { chartmetric_id: null, via: null }
}
