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
  | 'no-match'
  | 'error'

export interface ResolveResult {
  rawName: string
  outcome: ResolveOutcome
  chartmetric_id: number | null
  rowCreated: boolean
  note?: string
  error?: string
}

export interface ExistingArtist {
  chartmetric_id: number
  name: string
}

export interface ResolveDeps {
  client: ReturnType<typeof createServiceClient>
  getToken: () => Promise<string> // memoized by the caller — one token per run
  existing: ExistingArtist[] // already-fetched intel_artists (name + id)
  source: string // 'monday' | 'radar' | …
  discoveryStatus: string // 'pipeline' | 'new' | …
}

// Ordered, de-duped normalized candidate names. Full name FIRST so band names
// containing separators ("Andy Frasco & The U.N.") resolve whole before any split.
export function candidateNames(rawName: string): string[] {
  const out: string[] = []
  const push = (s: string | null | undefined) => {
    if (!s) return
    const n = normalizeArtistName(s)
    if (n && !out.includes(n)) out.push(n)
  }
  const t = rawName.trim()
  push(t) // 1. full normalized
  if (t.includes('(')) push(t.replace(/\(.*?\)/g, ' ').trim()) // 2. strip parentheticals
  if (/\s-\s/.test(t)) push(t.split(/\s-\s/)[0]) // 3. strip " - venue" suffix
  // 4. co-bill primary (NOT '&'): + x / feat featuring with
  const coBill = t.split(/\s+(?:\+|x|\/|feat\.?|featuring|with)\s+/i)[0]
  if (coBill && coBill !== t) push(coBill)
  // 5. '&'-split primary — LAST resort only (full name already tried at step 1)
  if (t.includes('&')) push(t.split(/\s*&\s*/)[0])
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
  const normMap = new Map<string, number>()
  const existingIds = new Set<number>()
  const normList: { norm: string; id: number }[] = []
  for (const a of deps.existing) {
    if (!a.name) continue
    const n = normalizeArtistName(a.name)
    if (!normMap.has(n)) normMap.set(n, a.chartmetric_id)
    normList.push({ norm: n, id: a.chartmetric_id })
    existingIds.add(a.chartmetric_id)
  }

  // 2a. REUSE-BEFORE-PAY — exact normalized against existing roster (0 CM).
  for (const c of cands) {
    const hit = normMap.get(c)
    if (hit !== undefined) return { rawName, outcome: 'matched-existing', chartmetric_id: hit, rowCreated: false }
  }

  // 2b. REUSE-BEFORE-PAY — trigram fuzzy against existing roster (0 CM).
  const probe = cands[0]
  if (probe.length >= MIN_FUZZY_LEN) {
    let best: { id: number; score: number } | null = null
    for (const e of normList) {
      if (e.norm.length < MIN_FUZZY_LEN) continue
      const score = diceCoefficient(probe, e.norm)
      if (!best || score > best.score) best = { id: e.id, score }
    }
    if (best && best.score >= TRIGRAM_THRESHOLD) {
      return { rawName, outcome: 'matched-existing', chartmetric_id: best.id, rowCreated: false, note: `fuzzy ${best.score.toFixed(2)}` }
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
  let searchedNorm = ''
  try {
    for (const c of cands) {
      const r = await cmSearchArtists(c, token)
      if (r.length) {
        candidates = r
        searchedNorm = c
        break
      }
    }
  } catch (err) {
    return { rawName, outcome: 'error', chartmetric_id: null, rowCreated: false, error: err instanceof Error ? err.message : 'CM search failed' }
  }

  // True zero-candidate → the ONLY case that stamps the negative cache (caller).
  if (!candidates.length) return { rawName, outcome: 'no-match', chartmetric_id: null, rowCreated: false }

  // Selection: exact-normalized wins; otherwise highest cm_score / followers.
  // Never skip on ambiguity — deterministically tiebreak to the real artist.
  const exact = candidates.filter((c) => normalizeArtistName(c.name) === searchedNorm)
  const pool = exact.length ? exact : candidates
  pool.sort((a, b) => (b.cm_score ?? 0) - (a.cm_score ?? 0) || (b.followers ?? 0) - (a.followers ?? 0))
  const chosen = pool[0]
  const tiebroken = exact.length === 0 && candidates.length > 1

  // Already in intel_artists under a different name → link, no insert, no spend on insert.
  if (existingIds.has(chosen.id)) {
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
