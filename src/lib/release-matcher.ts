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

// ── Album noise / reissue filter (applies to ALL scrapers) ──
// Drops non-new-studio releases: reissues, anniversary/deluxe/expanded
// editions, vinyl reissues, remasters, box sets, soundtracks, live albums,
// compilations, "Various Artists", and deceased-catalog patterns. Keeps new
// studio albums/EPs. Tested against title patterns; conservative on the keep
// side (only drops on a clear noise marker).
const NOISE_TITLE_PATTERNS: RegExp[] = [
  /\b(re-?issue|re-?master(ed|s)?|remastered)\b/i,
  /\b(deluxe|expanded|super deluxe|collector'?s?)\b.*\b(edition|version|reissue)\b/i,
  /\b(deluxe|expanded)\s+(edition|version)\b/i,
  /\b\d+(st|nd|rd|th)?\s*anniversary\b/i,
  /\banniversary\s+(edition|reissue|version)\b/i,
  /\b(box\s?set|boxset)\b/i,
  /\bvinyl\b.*\b(reissue|edition|pressing|release)\b/i,
  /\b(live\s+(at|from|in)\b|\(live\)|\blive\s+album\b)/i,
  /\b(greatest hits|best of|the\s+collection|compilation|anthology|b-sides|rarities)\b/i,
  /\b(soundtrack|original score|music from|motion picture|o\.?s\.?t\.?)\b/i,
  /\bunplugged\b/i,
  /\bdemos?\b.*\b(collection|sessions)\b/i,
]
const NOISE_ARTIST_PATTERNS: RegExp[] = [
  /\bvarious artists?\b/i,
  /\bv\/?a\b/i,
  /\b(original (broadway|london) cast|cast recording)\b/i,
]

/** True if this release should be dropped as non-new-studio noise. */
export function isNoiseRelease(artistNameRaw: string, albumName: string): boolean {
  const a = artistNameRaw || ''
  const t = albumName || ''
  if (NOISE_ARTIST_PATTERNS.some(re => re.test(a))) return true
  if (NOISE_TITLE_PATTERNS.some(re => re.test(t))) return true
  return false
}

// ── Career-stage gate (applies to ALL scrapers) ──
// Surface releases only for artists at mid-level or above. developing,
// undiscovered, and unknown/null career stages are dropped.
export const CAREER_KEEP = new Set(['mid-level', 'mainstream', 'superstar', 'legendary'])

/** True if the artist's career stage clears the bar (mid-level+). null/unknown → false. */
export function careerStageAllowed(stage: string | null | undefined): boolean {
  if (!stage) return false
  return CAREER_KEEP.has(stage.toLowerCase().trim())
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

/** Pre-load all artists + aliases into in-memory maps for O(1) lookup.
 *  Paginates artists in 1000-row pages — Supabase REST defaults to 1000, so
 *  rosters >1000 silently truncate without explicit ranges. */
export async function buildMatcherIndex(supabase: SupabaseClient): Promise<MatcherIndex> {
  const byName = new Map<string, number>()
  const byAlias = new Map<string, number>()

  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data: artists, error: artistErr } = await supabase
      .from('intel_artists')
      .select('chartmetric_id, name')
      .order('chartmetric_id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (artistErr) throw new Error(`buildMatcherIndex artists: ${artistErr.message}`)
    if (!artists || artists.length === 0) break
    for (const a of artists) {
      if (!a.name || a.chartmetric_id == null) continue
      const norm = normalizeName(a.name)
      if (!norm) continue
      // First write wins — collisions on normalized name are rare but real
      if (!byName.has(norm)) byName.set(norm, a.chartmetric_id)
    }
    if (artists.length < PAGE) break
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
