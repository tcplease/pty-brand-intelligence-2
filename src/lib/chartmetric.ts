// Shared Chartmetric enrichment helpers.
//
// Both the canonical sync route (/api/sync/chartmetric) and the Monday sync
// route (/api/sync/monday) enrich artists from Chartmetric. They used to carry
// divergent inline parses — the Monday route hit the dead
// `instagram-audience-data?field=…` endpoint (404) for demographics/brands/
// sectors and read a nonexistent `monthly_listeners` key. These helpers are the
// single correct implementation both routes call.
//
// Field-name notes (verified against the live API, June 2026):
// - /stat/spotify returns `obj.listeners` (a time series), NOT `monthly_listeners`.
// - Audience demographics/brands/sectors all live in one payload:
//   /artist/:id/instagram-audience-stats → obj.{audience_genders,
//   audience_genders_per_age, audience_ethnicities, top_countries,
//   audience_brand_affinities, audience_interests, followers}.

const CM_BASE = 'https://api.chartmetric.com/api'

/* eslint-disable @typescript-eslint/no-explicit-any -- CM responses are untyped JSON */

interface StatPoint {
  value?: number | null
  timestp?: string
  is_interpolated?: boolean
}

// Pick the most recent value from a Chartmetric stat time series.
// The array is not guaranteed chronological, so sort by `timestp` (ISO date
// strings sort lexicographically). Prefer the latest real (non-interpolated)
// point; fall back to the latest point overall if the tail is all interpolated.
export function latestStatValue(series: StatPoint[] | null | undefined): number | null {
  if (!Array.isArray(series) || series.length === 0) return null
  const withValue = series.filter(p => p && p.value != null)
  if (withValue.length === 0) return null

  const byTimestpAsc = (a: StatPoint, b: StatPoint) =>
    (a.timestp || '').localeCompare(b.timestp || '')

  const real = withValue.filter(p => p.is_interpolated === false).sort(byTimestpAsc)
  if (real.length > 0) return real[real.length - 1].value ?? null

  const all = [...withValue].sort(byTimestpAsc)
  return all[all.length - 1].value ?? null
}

function parseFloatOrNull(val: any): number | null {
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Sum male+female weight for a given age bucket in audience_genders_per_age.
function agePct(ageGender: any[], ageCode: string): number {
  const row = ageGender?.find((r: any) => r.code === ageCode)
  if (!row) return 0
  return round2(parseFloat(row.male || '0') + parseFloat(row.female || '0'))
}

export interface DemographicFields {
  audience_male_pct: number | null
  audience_female_pct: number | null
  age_13_17_pct: number | null
  age_18_24_pct: number | null
  age_25_34_pct: number | null
  age_35_44_pct: number | null
  age_45_64_pct: number | null
  age_65_plus_pct: number | null
  audience_ethnicity: Record<string, number> | null
  top_countries: Array<{ country: string; code: string; pct: number }> | null
}

// Extract demographic fields from an instagram-audience-stats `obj`.
// Gender comes from `audience_genders`; when that array is empty (≈35 artists
// roster-wide that still have age/ethnicity/country data), fall back to summing
// male/female across `audience_genders_per_age`.
export function extractDemographics(audience: any): DemographicFields {
  const ageGender: any[] = audience?.audience_genders_per_age || []

  let male = parseFloatOrNull(audience?.audience_genders?.find((g: any) => g.code === 'male')?.weight)
  let female = parseFloatOrNull(audience?.audience_genders?.find((g: any) => g.code === 'female')?.weight)

  if (male == null && female == null && ageGender.length > 0) {
    let m = 0
    let f = 0
    for (const row of ageGender) {
      m += parseFloat(row.male || '0')
      f += parseFloat(row.female || '0')
    }
    if (m > 0 || f > 0) {
      male = round2(m)
      female = round2(f)
    }
  }

  const ethnicities: any[] = audience?.audience_ethnicities || []
  const ethnicity = ethnicities.length
    ? ethnicities.reduce((acc: Record<string, number>, e: any) => {
        acc[e.code] = parseFloat(e.weight || '0')
        return acc
      }, {})
    : null

  const topCountries = (audience?.top_countries || []).slice(0, 10).map((c: any) => ({
    country: c.name,
    code: c.code,
    pct: parseFloat(c.percent || '0'),
  }))

  return {
    audience_male_pct: male,
    audience_female_pct: female,
    age_13_17_pct: agePct(ageGender, '13-17'),
    age_18_24_pct: agePct(ageGender, '18-24'),
    age_25_34_pct: agePct(ageGender, '25-34'),
    age_35_44_pct: agePct(ageGender, '35-44'),
    age_45_64_pct: agePct(ageGender, '45-64'),
    age_65_plus_pct: agePct(ageGender, '65+'),
    audience_ethnicity: ethnicity,
    top_countries: topCountries.length ? topCountries : null,
  }
}

export interface BrandAffinityRow {
  chartmetric_id: number
  brand_id: number
  brand_name: string
  affinity_scale: number
  follower_count: number | null
  interest_category: string | null
}

export interface SectorAffinityRow {
  chartmetric_id: number
  sector_id: number
  sector_name: string
  affinity_scale: number
}

// Brand affinities (>= 1.0x) from the audience payload.
export function extractBrandAffinities(audience: any, cmId: number): BrandAffinityRow[] {
  return (audience?.audience_brand_affinities || [])
    .filter((b: any) => parseFloat(b.affinity) >= 1.0)
    .map((b: any) => ({
      chartmetric_id: cmId,
      brand_id: b.id || 0,
      brand_name: b.name,
      affinity_scale: parseFloat(b.affinity),
      follower_count: audience?.followers
        ? Math.round((parseFloat(b.weight || '0') / 100) * audience.followers)
        : null,
      interest_category: b.category || null,
    }))
}

// Sector/interest affinities (>= 1.0x) from the audience payload.
export function extractSectorAffinities(audience: any, cmId: number): SectorAffinityRow[] {
  return (audience?.audience_interests || [])
    .filter((s: any) => parseFloat(s.affinity) >= 1.0)
    .map((s: any, i: number) => ({
      chartmetric_id: cmId,
      sector_id: s.id || i,
      sector_name: s.name,
      affinity_scale: parseFloat(s.affinity),
    }))
}

export interface SocialUrls {
  spotify_artist_id: string | null
  instagram_url: string | null
  youtube_url: string | null
  tiktok_url: string | null
}

// Extract social profile URLs + the Spotify artist id from a CM /artist/:id/urls
// `obj` array (entries of { domain, url: string[] }). CM returns full, openable
// URLs for instagram/youtube/tiktok, so no handle→URL construction is needed.
export function extractSocialUrls(urlsObj: any[]): SocialUrls {
  const findUrl = (domain: string): string | null => {
    const entry = (urlsObj || []).find((u: any) => u.domain === domain)
    const url = Array.isArray(entry?.url) ? entry.url[0] : entry?.url
    return typeof url === 'string' && url.startsWith('http') ? url : null
  }
  const spotifyUrl = findUrl('spotify')
  return {
    spotify_artist_id: spotifyUrl ? (spotifyUrl.match(/artist\/([a-zA-Z0-9]+)/)?.[1] ?? null) : null,
    instagram_url: findUrl('instagram'),
    youtube_url: findUrl('youtube'),
    tiktok_url: findUrl('tiktok'),
  }
}

// Fetch the instagram-audience-stats payload (demographics + brands + sectors
// in one call). Returns the `obj` or null.
//
// `onError` is called ONLY on a real fetch failure (non-2xx or thrown) — not on
// a legitimate 200 that simply carries no audience data. This lets callers
// distinguish "Chartmetric errored" (alarm) from "this artist has no IG data"
// (expected) instead of silently writing null in both cases.
export async function getInstagramAudience(
  cmId: number,
  token: string,
  onError?: (detail: string) => void
): Promise<any | null> {
  try {
    const res = await fetch(`${CM_BASE}/artist/${cmId}/instagram-audience-stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      onError?.(`HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    return data?.obj || null
  } catch (err: any) {
    onError?.(`threw: ${err?.message || 'unknown'}`)
    return null
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
