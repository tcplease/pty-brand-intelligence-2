import { createServiceClient } from '@/lib/supabase'
import { normalizeArtistName } from '@/lib/future-shows'
import { cmSearchArtists, insertEnrichedArtist } from '@/lib/chartmetric-enrich'

// ── resolveAndEnrichArtist ────────────────────────────────────────────────────
// THE single ingestion resolver. Both the Monday sync and the Radar/leads path
// call this. Order of operations (cost-critical):
//   1. candidate generation (normalize + strip parens/venue/co-bill; & last)
//   2. REUSE-BEFORE-PAY: normalized + JS-trigram match against already-fetched
//      intel_artists names — ZERO Chartmetric spend when we already own the artist
//   3. only if no existing row: Chartmetric search, tiebreak by cm_score/followers
//      (never freeze on ambiguity), zero candidates = true no-match
//   4. INSERT + full enrichment (chartmetric-enrich.insertEnrichedArtist)
// Never re-inlines the stateful matcher or the enrichment — both are shared.

const TRIGRAM_THRESHOLD = 0.82
const MIN_FUZZY_LEN = 5 // don't fuzzy-match very short names (false positives)

export type ResolveOutcome =
  | 'matched-existing'
  | 'pulled-new'
  | 'ambiguous-tiebroken'
  | 'needs-review'
  | 'no-match'
  | 'error'

export interface ResolveResult {
  rawName: string
  outcome: ResolveOutcome
  chartmetric_id: number | null
  rowCreated: boolean
  note?: string
  error?: string
  reasons?: string[] // why it was routed to needs-review
}

export interface ExistingArtist {
  chartmetric_id: number
  name: string
  followers?: number | null // max(spotify, instagram) — for the confidence floor
}

// ── Confidence floor ──────────────────────────────────────────────────────────
// Generic/low-confidence resolutions (bare first names, single-token &-splits,
// low-similarity tiebreaks) auto-created wrong artists in the scoped backfill
// ("Brian"→143-follower act; "Arena One"→techno DJ). These route to needs-review
// instead of auto-create/link.
const POP_FLOOR = 5000

// Common bare first names that should never auto-create an artist on their own
// (short names ≤4 chars are caught separately). Lowercased, normalized.
const COMMON_FIRST_NAMES = new Set([
  'brian', 'bryan', 'david', 'james', 'john', 'chris', 'kevin', 'jason', 'aaron', 'jacob',
  'ethan', 'jared', 'derek', 'shawn', 'shaun', 'sarah', 'emily', 'megan', 'laura', 'jenna',
  'hannah', 'ashley', 'jessica', 'michael', 'robert', 'joseph', 'charles', 'thomas', 'daniel',
  'matthew', 'anthony', 'joshua', 'andrew', 'justin', 'brandon', 'jonathan', 'nicholas', 'tyler',
  'jeremy', 'adam', 'henry', 'nathan', 'zachary', 'jordan', 'gabriel', 'austin', 'carlos', 'jesse',
  'dylan', 'bradley', 'lucas', 'isaac', 'marcus', 'devin', 'caleb', 'trevor', 'blake', 'colton',
  'mason', 'hunter', 'connor', 'parker', 'mary', 'jennifer', 'linda', 'patricia', 'elizabeth',
  'susan', 'karen', 'nancy', 'lisa', 'margaret', 'sandra', 'kimberly', 'donna', 'michelle',
  'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'cynthia', 'kathleen', 'angela',
  'anna', 'brenda', 'pamela', 'nicole', 'samantha', 'katherine', 'christine', 'rachel', 'olivia',
  'emma', 'sophia', 'isabella', 'madison', 'chloe', 'abigail', 'joe', 'joon',
])

const isSingleToken = (s: string): boolean => !s.includes(' ')
const isGenericToken = (s: string): boolean =>
  isSingleToken(s) && (COMMON_FIRST_NAMES.has(s) || s.length <= 4)

// Returns the reasons a candidate→artist match is too low-confidence to auto-accept.
// Empty array = safe to auto-create/link. `targetPop` null → treat popularity as
// unknown-but-acceptable (only the shape/similarity gates apply).
export function lowConfidenceReasons(args: {
  matchedNorm: string
  origin: CandidateOrigin
  targetName: string
  targetPop: number | null | undefined
  tiebroken: boolean
}): string[] {
  const { matchedNorm, origin, targetName, targetPop, tiebroken } = args
  const targetNorm = normalizeArtistName(targetName)
  const sim = diceCoefficient(matchedNorm, targetNorm)
  const popOk = targetPop == null ? true : targetPop >= POP_FLOOR
  const strongExact = sim >= 0.999 && popOk

  // Token containment: the deal name often wraps the real artist ("Marcus King Band"
  // ⊃ "The Marcus King Band", "Gipsy Kings ft. X" ⊃ "Gipsy Kings"). When one name's
  // tokens are a subset of the other's, a low dice score is NOT a wrong match — so the
  // tiebreak gate is exempt. The bad case ("Arena One" vs "AREA ØNE") is NOT contained.
  const aTok = new Set(matchedNorm.split(' ').filter(Boolean))
  const bTok = new Set(targetNorm.split(' ').filter(Boolean))
  const subset = (small: Set<string>, big: Set<string>) => small.size > 0 && [...small].every((t) => big.has(t))
  const contained = subset(aTok, bTok) || subset(bTok, aTok)

  const reasons: string[] = []
  if (isGenericToken(matchedNorm) && !strongExact) reasons.push('generic-token')
  if (origin === 'ampersand' && isSingleToken(matchedNorm) && !(isSingleToken(targetNorm) === false || strongExact)) {
    reasons.push('ampersand-split')
  }
  if (tiebroken && sim < 0.9 && !contained) reasons.push('low-sim-tiebreak')
  return reasons
}

export interface ResolveDeps {
  client: ReturnType<typeof createServiceClient>
  getToken: () => Promise<string> // memoized by the caller — one token per run
  existing: ExistingArtist[] // already-fetched intel_artists (name + id)
  source: string // 'monday' | 'radar' | …
  discoveryStatus: string // 'pipeline' | 'new' | …
}

export type CandidateOrigin = 'full' | 'paren' | 'venue' | 'cobill' | 'ampersand'
export interface Candidate {
  norm: string
  origin: CandidateOrigin
}

// Ordered, de-duped normalized candidates, each tagged with how it was derived (the
// origin feeds the confidence floor — an ampersand-split single token is risky).
// Full name FIRST so band names with separators ("Andy Frasco & The U.N.") resolve
// whole before any split.
export function candidateNames(rawName: string): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  const push = (s: string | null | undefined, origin: CandidateOrigin) => {
    if (!s) return
    const n = normalizeArtistName(s)
    if (n && !seen.has(n)) {
      seen.add(n)
      out.push({ norm: n, origin })
    }
  }
  const t = rawName.trim()
  push(t, 'full') // 1. full normalized
  if (t.includes('(')) push(t.replace(/\(.*?\)/g, ' ').trim(), 'paren') // 2. strip parentheticals
  if (/\s-\s/.test(t)) push(t.split(/\s-\s/)[0], 'venue') // 3. strip " - venue" suffix
  // 4. co-bill primary (NOT '&'): + x / ft feat featuring with
  const coBill = t.split(/\s+(?:\+|x|\/|ft\.?|feat\.?|featuring|with)\s+/i)[0]
  if (coBill && coBill !== t) push(coBill, 'cobill')
  // 5. '&'-split primary — LAST resort only (full name already tried at step 1)
  if (t.includes('&')) push(t.split(/\s*&\s*/)[0], 'ampersand')
  return out
}

// ── JS trigram (Sørensen–Dice on character bigrams) — no pg_trgm / DDL needed ──
function bigrams(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const aB = bigrams(a)
  const counts = new Map<string, number>()
  for (const g of aB) counts.set(g, (counts.get(g) || 0) + 1)
  let inter = 0
  const bB = bigrams(b)
  for (const g of bB) {
    const c = counts.get(g) || 0
    if (c > 0) {
      inter++
      counts.set(g, c - 1)
    }
  }
  return (2 * inter) / (aB.length + bB.length)
}

export async function resolveAndEnrichArtist(
  rawName: string,
  deps: ResolveDeps,
): Promise<ResolveResult> {
  const cands = candidateNames(rawName)
  if (!cands.length) return { rawName, outcome: 'no-match', chartmetric_id: null, rowCreated: false }

  // Build lookup maps from the pre-fetched roster (caller fetches once per run).
  const normMap = new Map<string, ExistingArtist>()
  const existing = new Map<number, ExistingArtist>()
  const normList: { norm: string; a: ExistingArtist }[] = []
  for (const a of deps.existing) {
    if (!a.name) continue
    const n = normalizeArtistName(a.name)
    if (!normMap.has(n)) normMap.set(n, a)
    normList.push({ norm: n, a })
    existing.set(a.chartmetric_id, a)
  }

  // 2a. REUSE-BEFORE-PAY — exact normalized against existing roster (0 CM).
  for (const c of cands) {
    const hit = normMap.get(c.norm)
    if (hit) {
      const reasons = lowConfidenceReasons({ matchedNorm: c.norm, origin: c.origin, targetName: hit.name, targetPop: hit.followers ?? null, tiebroken: false })
      if (reasons.length) return { rawName, outcome: 'needs-review', chartmetric_id: null, rowCreated: false, reasons, note: `existing CM ${hit.chartmetric_id}` }
      return { rawName, outcome: 'matched-existing', chartmetric_id: hit.chartmetric_id, rowCreated: false }
    }
  }

  // 2b. REUSE-BEFORE-PAY — trigram fuzzy against existing roster (0 CM).
  const probe = cands[0]
  if (probe.norm.length >= MIN_FUZZY_LEN) {
    let best: { a: ExistingArtist; score: number } | null = null
    for (const e of normList) {
      if (e.norm.length < MIN_FUZZY_LEN) continue
      const score = diceCoefficient(probe.norm, e.norm)
      if (!best || score > best.score) best = { a: e.a, score }
    }
    if (best && best.score >= TRIGRAM_THRESHOLD) {
      const reasons = lowConfidenceReasons({ matchedNorm: probe.norm, origin: probe.origin, targetName: best.a.name, targetPop: best.a.followers ?? null, tiebroken: false })
      if (reasons.length) return { rawName, outcome: 'needs-review', chartmetric_id: null, rowCreated: false, reasons, note: `fuzzy ${best.score.toFixed(2)} → CM ${best.a.chartmetric_id}` }
      return { rawName, outcome: 'matched-existing', chartmetric_id: best.a.chartmetric_id, rowCreated: false, note: `fuzzy ${best.score.toFixed(2)}` }
    }
  }

  // 3. CM search — only now do we spend. Try candidates until one returns results.
  let token: string
  try {
    token = await deps.getToken()
  } catch {
    return { rawName, outcome: 'error', chartmetric_id: null, rowCreated: false, error: 'CM token failed' }
  }

  let candidates: Awaited<ReturnType<typeof cmSearchArtists>> = []
  let searched: Candidate | null = null
  try {
    for (const c of cands) {
      const r = await cmSearchArtists(c.norm, token)
      if (r.length) {
        candidates = r
        searched = c
        break
      }
    }
  } catch (err) {
    return { rawName, outcome: 'error', chartmetric_id: null, rowCreated: false, error: err instanceof Error ? err.message : 'CM search failed' }
  }

  // True zero-candidate → the ONLY case that stamps the negative cache (caller).
  if (!candidates.length || !searched) return { rawName, outcome: 'no-match', chartmetric_id: null, rowCreated: false }

  // Selection: exact-normalized wins; otherwise highest cm_score / followers.
  // Never skip on ambiguity — deterministically tiebreak to the real artist.
  const exact = candidates.filter((c) => normalizeArtistName(c.name) === searched!.norm)
  const pool = exact.length ? exact : candidates
  pool.sort((a, b) => (b.cm_score ?? 0) - (a.cm_score ?? 0) || (b.followers ?? 0) - (a.followers ?? 0))
  const chosen = pool[0]
  const tiebroken = exact.length === 0 && candidates.length > 1

  // CONFIDENCE FLOOR — before any create/link. Low-confidence resolutions (bare
  // generic token, single-token &-split, low-similarity tiebreak) go to review.
  const reasons = lowConfidenceReasons({ matchedNorm: searched.norm, origin: searched.origin, targetName: chosen.name, targetPop: chosen.followers ?? null, tiebroken })
  if (reasons.length) {
    return { rawName, outcome: 'needs-review', chartmetric_id: null, rowCreated: false, reasons, note: `candidate CM ${chosen.id} "${chosen.name}"` }
  }

  // Already in intel_artists under a different name → link, no insert, no spend on insert.
  if (existing.has(chosen.id)) {
    return { rawName, outcome: tiebroken ? 'ambiguous-tiebroken' : 'matched-existing', chartmetric_id: chosen.id, rowCreated: false }
  }

  // 4. INSERT + full enrichment. Surface (don't swallow) any failure.
  const res = await insertEnrichedArtist(deps.client, chosen.id, token, {
    source: deps.source,
    discovery_status: deps.discoveryStatus,
    fallbackName: chosen.name,
  })
  if (res.error) {
    return { rawName, outcome: 'error', chartmetric_id: chosen.id, rowCreated: false, error: res.error }
  }
  return { rawName, outcome: tiebroken ? 'ambiguous-tiebroken' : 'pulled-new', chartmetric_id: chosen.id, rowCreated: true }
}
