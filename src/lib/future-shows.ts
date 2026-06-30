// Pure helpers for the Future Shows sync (board 5517797966).
// Kept free of I/O so the parsing/matching rules (B2/B3) are unit-testable.

export type GeoStatus = 'ok' | 'unknown'
export type MatchStatus = 'exact' | 'normalized' | 'unmatched'

export interface ParsedVenue {
  venue_name: string | null
  city: string | null
  state: string | null
  country: string | null
  geo_status: GeoStatus
  full_address: string | null
}

// B2 — Venue parser. Operates on the Monday location column's `text`
// (the comma blob, e.g. "Greek Theatre, North Vermont Avenue, Los Angeles, CA, USA").
// Rules applied in order; validated against the live board (2,089 rows).
export function parseVenue(blob: string | null | undefined): ParsedVenue {
  const raw = (blob ?? '').trim()

  // Bare venue name (no commas) or empty → unknown geo, excluded from filters.
  if (!raw || !raw.includes(',')) {
    return {
      venue_name: raw || null,
      city: null,
      state: null,
      country: null,
      geo_status: 'unknown',
      full_address: raw || null,
    }
  }

  const segments = raw.split(',').map((s) => s.trim())
  const len = segments.length

  const countryRaw = segments[len - 1]
  const isUS = countryRaw.toUpperCase() === 'USA'
  const country = isUS ? 'US' : countryRaw

  // State: second-to-last segment, only if a US 2-letter code.
  const secondToLast = segments[len - 2]
  const state = isUS && /^[A-Z]{2}$/.test(secondToLast) ? secondToLast : null

  // City: segment before the state (US), else the segment before country.
  const cityIdx = state !== null ? len - 3 : len - 2
  const city = cityIdx >= 0 ? (segments[cityIdx] ?? null) : null

  return {
    venue_name: segments[0] || null,
    city: city || null,
    state,
    country,
    geo_status: 'ok',
    full_address: raw,
  }
}

// B3 — name normalization for the second matching pass.
// Fold accents to their base letters BEFORE stripping punctuation, otherwise
// `\w` (ASCII-only) would delete the accented char entirely
// ("Mötley Crüe" → "mtley cre"). NFD decomposes "ö" → "o" + combining mark,
// then we remove the combining marks (U+0300–U+036F) so "ö" → "o".
export function normalizeArtistName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks → base letters
    .toLowerCase()
    .replace(/[-–—]+/g, ' ') // hyphens/dashes → space, so "Salt-N-Pepa" === "Salt N Pepa"
    .replace(/[^\w\s]/g, '') // strip remaining punctuation
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
}

// Co-bill headliner = text before the first " & ", " x ", " + ", " ft. ", or " / "
// separator (per build doc). e.g. "Bob Moses & Cannons" → "Bob Moses";
// "Gipsy Kings ft. Nicholas Reyes" → "Gipsy Kings"; "Fab Morvan / Milli Vanilli" → "Fab Morvan".
export function coBillHeadliner(name: string): string | null {
  const parts = name.split(/\s+(?:&|x|\+|ft\.|\/)\s+/i)
  return parts.length > 1 ? parts[0].trim() : null
}

export interface ArtistMatch {
  chartmetric_id: number | null
  match_status: MatchStatus
}

// B3 — match an artist name against intel_artists. `exactMap` is keyed by
// lowercased+trimmed name; `normMap` by normalizeArtistName(). Both built once
// from intel_artists by the caller.
export function matchArtist(
  rawName: string,
  exactMap: Map<string, number>,
  normMap: Map<string, number>,
): ArtistMatch {
  const tryName = (name: string): ArtistMatch | null => {
    const exact = exactMap.get(name.toLowerCase().trim())
    if (exact !== undefined) return { chartmetric_id: exact, match_status: 'exact' }
    const norm = normMap.get(normalizeArtistName(name))
    if (norm !== undefined) return { chartmetric_id: norm, match_status: 'normalized' }
    return null
  }

  const direct = tryName(rawName)
  if (direct) return direct

  const headliner = coBillHeadliner(rawName)
  if (headliner) {
    const viaHeadliner = tryName(headliner)
    if (viaHeadliner) return viaHeadliner
  }

  return { chartmetric_id: null, match_status: 'unmatched' }
}
