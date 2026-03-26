'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import HelpOverlay from '@/components/ui/HelpOverlay'

// ── Constants ─────────────────────────────────────────
const BG = '#0f0f0f'
const SURFACE = '#1e1e1e'
const SURFACE2 = '#1e1e1e'
const BORDER = 'rgba(255,255,255,0.08)'
const Y = '#F9D40A'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'
const GREEN = '#00D26A'

const CAREER_COLORS: Record<string, string> = {
  legendary: '#ef4444',
  superstar: '#f97316',
  mainstream: '#F9D40A',
  'mid-level': '#00D26A',
  developing: '#4A9EFF',
  undiscovered: 'rgba(255,255,255,0.3)',
}

const BLUE = '#60bae1'

const STAGE_COLORS: Record<string, string> = {
  'Outbound - No Contact': '#666',
  'Outbound - Automated Contact': '#666',
  'Prospect - Direct Sales Agent Contact': BLUE,
  'Active Leads (Contact Has Responded)': BLUE,
  'Proposal (financials submitted)': Y,
  'Negotiation (Terms Being Discussed)': Y,
  'Finalizing On-Sale (Terms Agreed)': GREEN,
  'Won (Final On-Sale Planned)': GREEN,
}

const STAGE_SHORT_LABELS: Record<string, string> = {
  'Outbound - No Contact': 'Outbound (No Contact)',
  'Outbound - Automated Contact': 'Outbound (Automated)',
  'Prospect - Direct Sales Agent Contact': 'Prospect',
  'Active Leads (Contact Has Responded)': 'Active Lead',
  'Proposal (financials submitted)': 'Proposal',
  'Negotiation (Terms Being Discussed)': 'Negotiation',
  'Finalizing On-Sale (Terms Agreed)': 'Finalizing',
  'Won (Final On-Sale Planned)': 'Won',
}

const AGE_RANGES = ['13-17', '18-24', '25-34', '35-44', '45-64', '65+']

const TOP_SECTORS = [
  'Activewear', 'Art & Design', 'Beauty & Cosmetics',
  'Beer, Wine & Spirits', 'Business & Careers', 'Camera & Photography',
  'Cars & Motorbikes', 'Clothes, Shoes, Handbags & Accessories',
  'Coffee, Tea & Beverages', 'Electronics & Computers', 'Fitness & Yoga',
  'Friends, Family & Relationships', 'Gaming', 'Healthcare & Medicine',
  'Healthy Lifestyle', 'Home Decor, Furniture & Garden', 'Jewellery & Watches',
  'Luxury Goods', 'Music', 'Pets',
  'Restaurants, Food & Grocery', 'Shopping & Retail', 'Sports',
  'Television & Film', 'Toys, Children & Baby', 'Travel, Tourism & Aviation',
  'Wedding',
]

// ── Types ─────────────────────────────────────────────
interface Artist {
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
  demographic_pct: number
  affinity_score: number
  combined_score: number
  deal_stage: string | null
}

interface BrandSuggestion { name: string; artist_count: number }

// ── Helpers ───────────────────────────────────────────
function formatNum(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function getMomentumColor(score: number | null): string {
  if (!score) return '#555'
  if (score >= 95) return '#4ade80'
  if (score >= 85) return '#F9D40A'
  if (score >= 70) return '#ff9800'
  return '#f87171'
}

// ── Artist Card (matches Pipeline/Radar) ──────────────
function MatchArtistCard({ artist, query, onClick }: {
  artist: Artist
  query: { brand: string; gender: string; ages: string[] }
  onClick: () => void
}) {
  const score = artist.cm_score ? Math.round(Number(artist.cm_score)) : null
  const careerColor = CAREER_COLORS[artist.career_stage?.toLowerCase() ?? ''] ?? W50
  const stageColor = artist.deal_stage ? (STAGE_COLORS[artist.deal_stage] ?? W50) : null
  const hasBrand = !!query.brand
  const hasDemoFilter = query.ages.length > 0 || query.gender !== 'any'
  const demoPct = artist.demographic_pct
  const affinityScore = artist.affinity_score

  return (
    <div onClick={onClick} className="block h-full cursor-pointer" style={{ color: '#f5f4f2' }}>
      <div className="flex flex-col h-full" style={{ backgroundColor: SURFACE, borderRadius: '8px', overflow: 'hidden', border: `1px solid ${BORDER}` }}>
        {/* Image */}
        <div className="relative shrink-0 aspect-square md:aspect-auto md:h-[160px]" style={{ backgroundColor: '#2a2a2a' }}>
          {artist.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artist.image_url} alt={artist.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center font-bold text-4xl" style={{ color: '#444' }}>
              {artist.name[0]}
            </div>
          )}
          {score !== null && (
            <div className="absolute font-bold" style={{ top: '8px', right: '8px', backgroundColor: 'rgba(27,27,27,0.9)', color: Y, fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px' }}>
              {score}
            </div>
          )}
          <div className="absolute rounded-full" style={{ top: '10px', left: '8px', width: '7px', height: '7px', backgroundColor: getMomentumColor(artist.cm_score) }} />

        </div>

        {/* Info */}
        <div className="flex-1 flex flex-col" style={{ padding: '10px 12px 12px' }}>
          <div className="truncate" style={{ fontSize: '13px', fontWeight: 600, color: '#f5f4f2', marginBottom: '2px' }}>
            {artist.name}
          </div>
          {/* Match scores */}
          {(hasDemoFilter || hasBrand) && (
            <div className="flex items-center gap-2 mb-1">
              {hasDemoFilter && demoPct > 0 && (
                <span className="font-bold font-mono" style={{ fontSize: '10px', color: '#9c9b99' }}>
                  {demoPct.toFixed(0)}% demo
                </span>
              )}
              {hasBrand && affinityScore > 0 && (
                <span className="font-bold font-mono" style={{ fontSize: '10px', color: '#9c9b99' }}>
                  {affinityScore.toFixed(1)}x affinity
                </span>
              )}
            </div>
          )}
          <div className="flex flex-col" style={{ gap: '1px', marginBottom: '8px' }}>
            {artist.primary_genre && (
              <div style={{ lineHeight: 1 }}>
                <span style={{
                  fontSize: '8px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
                  background: 'rgba(255,255,255,0.07)', color: W50,
                  textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-block',
                }}>{artist.primary_genre}</span>
              </div>
            )}
            {artist.career_stage && (
              <div style={{ lineHeight: 1 }}>
                <span style={{
                  fontSize: '8px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
                  background: `${careerColor}15`, color: careerColor,
                  textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-block',
                }}>{artist.career_stage}</span>
              </div>
            )}
            {stageColor && artist.deal_stage && (
              <div style={{ lineHeight: 1 }}>
                <span style={{
                  fontSize: '8px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
                  background: `${stageColor}15`, color: stageColor,
                  textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-block',
                }}>{STAGE_SHORT_LABELS[artist.deal_stage] ?? artist.deal_stage}</span>
              </div>
            )}
          </div>

          {/* Social stats pinned to bottom */}
          <div className="mt-auto flex items-center" style={{ gap: '8px' }}>
            <div className="flex items-center" style={{ gap: '3px' }}>
              <svg style={{ width: '11px', height: '11px', color: '#888', flexShrink: 0 }} viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              <span style={{ fontSize: '11px', color: '#888' }}>{formatNum(artist.spotify_followers)}</span>
            </div>
            <div className="flex items-center" style={{ gap: '3px' }}>
              <svg style={{ width: '11px', height: '11px', color: '#888', flexShrink: 0 }} viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6m9.65 1.5a1.25 1.25 0 0 1 1.25 1.25A1.25 1.25 0 0 1 17.25 8 1.25 1.25 0 0 1 16 6.75a1.25 1.25 0 0 1 1.25-1.25M12 7a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>
              </svg>
              <span style={{ fontSize: '11px', color: '#888' }}>{formatNum(artist.instagram_followers)}</span>
            </div>
            <div className="flex items-center" style={{ gap: '3px' }}>
              <svg style={{ width: '11px', height: '11px', color: '#888', flexShrink: 0 }} viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z"/>
              </svg>
              <span style={{ fontSize: '11px', color: '#888' }}>{formatNum(artist.tiktok_followers)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────
export default function BrandSearchPage() {
  const router = useRouter()

  // Filters
  const [brandInput, setBrandInput] = useState('')
  const [brandQuery, setBrandQuery] = useState('')
  const [brandSuggestions, setBrandSuggestions] = useState<BrandSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedAges, setSelectedAges] = useState<string[]>([])
  const [gender, setGender] = useState<'any' | 'female' | 'male'>('any')
  const [threshold, setThreshold] = useState(20)
  const [showSectors, setShowSectors] = useState(false)
  const [showFilters, setShowFilters] = useState(true)

  // Results
  const [results, setResults] = useState<Artist[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // Career stage filter
  const [careerFilter, setCareerFilter] = useState<string>('All')
  const careerStages = ['All', 'Legendary', 'Superstar', 'Mainstream', 'Mid-Level', 'Developing', 'Undiscovered']

  const brandInputRef = useRef<HTMLInputElement>(null)

  // Brand autocomplete
  useEffect(() => {
    if (brandInput.length < 2) { setBrandSuggestions([]); return }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/brands?q=${encodeURIComponent(brandInput)}`)
        const data = await res.json()
        setBrandSuggestions(data.brands || [])
        setShowSuggestions(true)
      } catch { /* ignore */ }
    }, 200)
    return () => clearTimeout(t)
  }, [brandInput])

  // Auto re-search when demographic filters change (only after initial search)
  useEffect(() => {
    if (!hasSearched || !hasBrandSelected) return
    const t = setTimeout(() => runSearch(), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAges, gender, threshold])

  const toggleAge = (age: string) => {
    setSelectedAges(prev =>
      prev.includes(age) ? prev.filter(a => a !== age) : [...prev, age]
    )
  }

  const runSearch = useCallback(async () => {
    setLoading(true)
    setHasSearched(true)
    try {
      const params = new URLSearchParams()
      if (brandQuery) params.set('brand', brandQuery)
      if (gender !== 'any') params.set('gender', gender)
      if (selectedAges.length > 0) params.set('ages', selectedAges.join(','))
      params.set('threshold', String(threshold))

      const res = await fetch(`/api/brand-search?${params}`)
      const data = await res.json()
      setResults(data.artists || [])
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }, [brandQuery, gender, selectedAges, threshold])

  const hasBrandSelected = !!brandQuery
  const hasFilters = hasBrandSelected || selectedAges.length > 0 || gender !== 'any'

  const clearAll = () => {
    setBrandInput('')
    setBrandQuery('')
    setSelectedAges([])
    setGender('any')
    setThreshold(20)
    setResults([])
    setHasSearched(false)
    setCareerFilter('All')
  }

  // Filter results by career stage client-side
  const filteredResults = careerFilter === 'All'
    ? results
    : results.filter(a => a.career_stage?.toLowerCase() === careerFilter.toLowerCase())

  return (
    <div className="min-h-screen" style={{ backgroundColor: BG, color: '#f5f4f2' }}>

      {/* NAV */}
      <nav className="flex items-center gap-4 px-4 md:px-6 py-3 border-b sticky top-0 z-50"
        style={{ background: BG, borderColor: BORDER }}>
        <img src="/pty-logo.svg" alt="P&TY" className="h-9 w-auto shrink-0" />
        <div className="h-4 w-px shrink-0" style={{ backgroundColor: BORDER }} />
        <Link href="/" className="text-sm py-3 px-3 block transition-colors hover:text-white" style={{ color: W50, touchAction: 'manipulation', WebkitTapHighlightColor: 'rgba(255,255,255,0.1)' }}>Pipeline</Link>
        <Link href="/radar" className="text-sm py-3 px-3 block transition-colors hover:text-white" style={{ color: W50, touchAction: 'manipulation', WebkitTapHighlightColor: 'rgba(255,255,255,0.1)' }}>Radar</Link>
        <Link href="/match" className="text-sm py-3 px-3 block font-medium" style={{ color: Y, touchAction: 'manipulation', WebkitTapHighlightColor: 'rgba(249,212,10,0.15)' }}>Match</Link>
        <div className="ml-auto"><HelpOverlay page="match" /></div>
      </nav>

      <div className="px-4 md:px-6 py-6 max-w-[1600px] mx-auto">

        {/* Compact filter bar — always visible */}
        <div className="mb-6 rounded-xl border p-4" style={{ background: SURFACE, borderColor: BORDER }}>

          {/* Row 1: Brand search + Find button */}
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <input
                ref={brandInputRef}
                value={brandInput}
                onChange={e => { setBrandInput(e.target.value); setBrandQuery('') }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && brandInput) { setBrandQuery(brandInput); setShowSuggestions(false); runSearch() }
                }}
                onFocus={() => brandSuggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                placeholder="Brand or sector (required)"
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors"
                inputMode="search" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                style={{
                  background: SURFACE2,
                  borderColor: brandQuery ? Y : BORDER,
                  color: '#fff',
                }}
              />
              {brandQuery && (
                <button
                  onClick={() => { setBrandInput(''); setBrandQuery('') }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs p-1"
                  style={{ color: W30 }}
                >✕</button>
              )}
              {showSuggestions && brandSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border overflow-hidden z-20"
                  style={{ background: SURFACE2, borderColor: '#2a2a2a' }}>
                  {brandSuggestions.slice(0, 8).map((b, i) => (
                    <button key={i}
                      onMouseDown={() => { setBrandQuery(b.name); setBrandInput(b.name); setShowSuggestions(false) }}
                      className="w-full px-4 py-2 text-left flex items-center justify-between hover:bg-white/5 active:bg-white/10 transition-colors border-b last:border-0"
                      style={{ borderColor: BORDER }}>
                      <span className="text-sm text-white">{b.name}</span>
                      <span className="text-xs" style={{ color: W30 }}>{b.artist_count} artists</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowSectors(s => !s)}
              className="px-3 py-2 rounded-lg border text-xs transition-colors active:opacity-70 shrink-0"
              style={{ borderColor: showSectors ? Y : BORDER, color: showSectors ? Y : W50 }}
            >Sectors</button>
            <button
              onClick={runSearch}
              disabled={loading || !hasBrandSelected}
              className="px-5 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-40 active:scale-95 shrink-0"
              style={{ background: Y, color: BG }}
            >
              {loading ? '...' : 'Find'}
            </button>
            {hasFilters && (
              <button onClick={clearAll} className="text-xs transition-colors active:opacity-70 shrink-0" style={{ color: W30 }}>
                Clear
              </button>
            )}
          </div>

          {/* Sector browser */}
          {showSectors && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {TOP_SECTORS.map(sector => (
                <button
                  key={sector}
                  onClick={() => { setBrandQuery(sector); setBrandInput(sector); setShowSectors(false); runSearch() }}
                  className="px-2.5 py-1 rounded-full text-xs border transition-colors hover:border-white/30 active:opacity-70"
                  style={{
                    background: brandQuery === sector ? `${Y}22` : 'transparent',
                    borderColor: brandQuery === sector ? Y : BORDER,
                    color: brandQuery === sector ? Y : W50,
                  }}
                >{sector}</button>
              ))}
            </div>
          )}

          {/* Row 2: Age + Gender inline */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wider shrink-0" style={{ color: W50 }}>Age</span>
            <div className="flex gap-1.5">
              {AGE_RANGES.map(age => (
                <button
                  key={age}
                  onClick={() => toggleAge(age)}
                  className="px-2.5 py-1 rounded-md text-xs font-medium border transition-colors active:opacity-70"
                  style={{
                    background: selectedAges.includes(age) ? `${Y}22` : 'transparent',
                    borderColor: selectedAges.includes(age) ? Y : BORDER,
                    color: selectedAges.includes(age) ? Y : W50,
                  }}
                >{age}</button>
              ))}
            </div>

            <div className="h-4 w-px shrink-0" style={{ backgroundColor: BORDER }} />

            <span className="text-xs font-semibold uppercase tracking-wider shrink-0" style={{ color: W50 }}>Gender</span>
            <div className="flex gap-1.5">
              {(['any', 'female', 'male'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className="px-2.5 py-1 rounded-md text-xs font-medium border transition-colors active:opacity-70"
                  style={{
                    background: gender === g ? `${Y}22` : 'transparent',
                    borderColor: gender === g ? Y : BORDER,
                    color: gender === g ? Y : W50,
                  }}
                >{g === 'any' ? 'Any' : g === 'female' ? 'F' : 'M'}</button>
              ))}
            </div>

            {/* Threshold slider — inline, only when demo filters active */}
            {(selectedAges.length > 0 || gender !== 'any') && (
              <>
                <div className="h-4 w-px shrink-0" style={{ backgroundColor: BORDER }} />
                <span className="text-xs font-semibold uppercase tracking-wider shrink-0" style={{ color: W50 }}>
                  Min <span style={{ color: Y }}>{threshold}%</span>
                </span>
                <input
                  type="range" min="5" max="60" step="5"
                  value={threshold}
                  onChange={e => { setThreshold(parseInt(e.target.value)); }}
                  className="w-32"
                  style={{ accentColor: Y }}
                />
              </>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: Y, borderTopColor: 'transparent' }} />
          </div>
        )}

        {/* Empty state — no search yet */}
        {!hasSearched && !loading && (
          <div className="text-center py-16" style={{ color: W30 }}>
            <div className="text-4xl mb-3 opacity-20">🎯</div>
            <div className="text-sm mb-1" style={{ color: W50 }}>Set your filters and hit Find Artists</div>
            <div className="text-xs">Use brand, demographic filters, or both</div>
          </div>
        )}

        {/* Empty state — no results */}
        {!loading && hasSearched && results.length === 0 && (
          <div className="text-center py-16" style={{ color: W30 }}>
            <div className="text-4xl mb-3 opacity-30">🔍</div>
            <div className="text-sm">No artists match. Try lowering the threshold or broadening the age range.</div>
          </div>
        )}

        {/* Results */}
        {!loading && results.length > 0 && (
          <div>
            {/* Results header */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="text-sm font-semibold" style={{ color: W50 }}>
                {filteredResults.length} ARTIST{filteredResults.length !== 1 ? 'S' : ''}
              </div>

              {/* Career stage filter chips */}
              <div className="flex items-center gap-2 overflow-x-auto">
                {careerStages.map(stage => (
                  <button
                    key={stage}
                    onClick={() => setCareerFilter(stage)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap active:opacity-70"
                    style={{
                      background: careerFilter === stage ? `${Y}22` : 'transparent',
                      borderColor: careerFilter === stage ? Y : BORDER,
                      color: careerFilter === stage ? Y : W50,
                    }}
                  >{stage}</button>
                ))}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 text-xs" style={{ color: W30 }}>
                {(selectedAges.length > 0 || gender !== 'any') && (
                  <span style={{ color: '#9c9b99' }}>● Demo match</span>
                )}
                {brandQuery && <span style={{ color: '#9c9b99' }}>● Brand affinity</span>}
              </div>
            </div>

            {/* Card grid — matches Pipeline/Radar */}
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {filteredResults.map(artist => (
                <MatchArtistCard
                  key={artist.chartmetric_id}
                  artist={artist}
                  query={{ brand: brandQuery, gender, ages: selectedAges }}
                  onClick={() => router.push(`/artists/${artist.chartmetric_id}`)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
