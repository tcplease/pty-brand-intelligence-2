'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Constants ─────────────────────────────────────────
const BG = '#0a0a0a'
const SURFACE = '#141414'
const SURFACE2 = '#1e1e1e'
const BORDER = 'rgba(255,255,255,0.08)'
const Y = '#F9D40A'
const W80 = 'rgba(255,255,255,0.8)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'
const GREEN = '#00D26A'

const AGE_RANGES = ['13-17', '18-24', '25-34', '35-44', '45-64', '65+']

const TOP_SECTORS = [
  'Fashion & Apparel', 'Beauty & Cosmetics', 'Fitness & Wellness',
  'Food & Beverage', 'Consumer Electronics', 'Automotive',
  'Travel & Hospitality', 'Financial Services', 'Gaming',
  'Sports & Outdoors', 'Streaming & Entertainment', 'Alcohol & Spirits',
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
  audience_male_pct: number | null
  audience_female_pct: number | null
  demographic_pct: number
  affinity_score: number
  combined_score: number
}

interface BrandSuggestion { name: string; artist_count: number }

// ── Helpers ───────────────────────────────────────────
function formatNum(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

// ── Result Card ───────────────────────────────────────
function ResultCard({ artist, query, onClick }: {
  artist: Artist
  query: { brand: string; gender: string; ages: string[] }
  onClick: () => void
}) {
  const hasBrand = !!query.brand
  const demoPct = artist.demographic_pct
  const affinityScore = artist.affinity_score

  return (
    <div
      onClick={onClick}
      className="cursor-pointer flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors hover:border-white/20"
      style={{ background: SURFACE2, borderColor: BORDER }}
    >
      {/* Photo */}
      <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0" style={{ backgroundColor: '#2a2a2a' }}>
        {artist.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artist.image_url} alt={artist.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-bold" style={{ color: '#444' }}>
            {artist.name[0]}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-white truncate">{artist.name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span style={{ fontSize: '11px', color: W50 }}>{artist.career_stage?.toUpperCase()}</span>
          {artist.primary_genre && (
            <>
              <span style={{ color: W30, fontSize: '11px' }}>·</span>
              <span style={{ fontSize: '11px', color: W30 }}>{artist.primary_genre.toUpperCase()}</span>
            </>
          )}
        </div>
      </div>

      {/* Demographic match */}
      {(query.ages.length > 0 || query.gender !== 'any') && (
        <div className="text-right shrink-0">
          <div className="font-bold text-sm" style={{ color: demoPct >= 30 ? GREEN : W80 }}>
            {demoPct.toFixed(1)}%
          </div>
          <div style={{ fontSize: '10px', color: W30 }}>
            {query.gender !== 'any' ? query.gender : 'audience'}
            {query.ages.length > 0 ? ` ${query.ages.join('/')}` : ''}
          </div>
        </div>
      )}

      {/* Brand affinity */}
      {hasBrand && affinityScore > 0 && (
        <div className="text-right shrink-0">
          <div className="font-bold text-sm" style={{ color: affinityScore >= 2 ? Y : W50 }}>
            {affinityScore.toFixed(2)}x
          </div>
          <div style={{ fontSize: '10px', color: W30 }}>affinity</div>
        </div>
      )}

      {/* Combined score */}
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs shrink-0"
        style={{ backgroundColor: 'rgba(249,212,10,0.15)', color: Y }}
      >
        {Math.round(artist.combined_score)}
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

  // Results
  const [results, setResults] = useState<Artist[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  const brandInputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

  // Brand autocomplete
  useEffect(() => {
    if (brandInput.length < 2) { setBrandSuggestions([]); return }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/brands?q=${encodeURIComponent(brandInput)}`)
        const data = await res.json()
        setBrandSuggestions(data.brands || [])
        setShowSuggestions(true)
      } catch {}
    }, 200)
    return () => clearTimeout(t)
  }, [brandInput])

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

  const hasFilters = brandQuery || selectedAges.length > 0 || gender !== 'any'

  const clearAll = () => {
    setBrandInput('')
    setBrandQuery('')
    setSelectedAges([])
    setGender('any')
    setThreshold(20)
    setResults([])
    setHasSearched(false)
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: BG, color: '#f5f4f2' }}>

      {/* NAV */}
      <nav className="flex items-center gap-4 px-6 border-b" style={{ backgroundColor: BG, borderColor: BORDER, height: '56px' }}>
        <div className="flex items-center gap-3 shrink-0">
          <img src="/pty-logo.svg" alt="P&TY" className="h-8 w-auto" />
          <span className="font-bold text-sm tracking-wide hidden sm:block text-white">BRAND INTELLIGENCE</span>
        </div>
        <div className="h-4 w-px mx-2 hidden sm:block" style={{ backgroundColor: BORDER }} />
        <button
          onClick={() => router.push('/')}
          className="text-sm transition-colors hover:text-white"
          style={{ color: W50 }}
        >
          Roster
        </button>
        <span className="text-sm font-semibold text-white">Brand Search</span>
      </nav>

      <div className="max-w-4xl mx-auto px-5 py-8">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Find Artists for a Brief</h1>
          <p style={{ color: W50, fontSize: '14px' }}>
            Describe the target audience and brand — we'll surface artists whose fans match.
          </p>
        </div>

        {/* Filter panel */}
        <div className="rounded-2xl border p-6 mb-6" style={{ background: SURFACE, borderColor: BORDER }}>

          {/* Brand / sector search */}
          <div className="mb-6">
            <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: W50 }}>
              Brand or Category <span style={{ color: W30 }}>(optional)</span>
            </label>
            <div className="relative">
              <input
                ref={brandInputRef}
                value={brandInput}
                onChange={e => { setBrandInput(e.target.value); setBrandQuery('') }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { setBrandQuery(brandInput); setShowSuggestions(false) }
                }}
                onFocus={() => brandSuggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                placeholder="Search for Nike, Adidas, fitness brands..."
                className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors"
                style={{
                  background: SURFACE2,
                  borderColor: brandQuery ? Y : BORDER,
                  color: '#fff',
                }}
              />
              {brandQuery && (
                <button
                  onClick={() => { setBrandInput(''); setBrandQuery('') }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                  style={{ color: W30 }}
                >✕</button>
              )}
              {showSuggestions && brandSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border overflow-hidden z-20"
                  style={{ background: SURFACE2, borderColor: '#2a2a2a' }}>
                  {brandSuggestions.slice(0, 8).map((b, i) => (
                    <button key={i}
                      onMouseDown={() => { setBrandQuery(b.name); setBrandInput(b.name); setShowSuggestions(false) }}
                      className="w-full px-4 py-2.5 text-left flex items-center justify-between hover:bg-white/5 transition-colors border-b last:border-0"
                      style={{ borderColor: BORDER }}>
                      <span className="text-sm text-white">{b.name}</span>
                      <span className="text-xs" style={{ color: W30 }}>{b.artist_count} artists</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Browse sectors */}
            <button
              onClick={() => setShowSectors(s => !s)}
              className="mt-2 text-xs transition-colors"
              style={{ color: showSectors ? Y : W30 }}
            >
              {showSectors ? '▲ Hide' : '▼ Browse'} by sector
            </button>

            {showSectors && (
              <div className="flex flex-wrap gap-2 mt-3">
                {TOP_SECTORS.map(sector => (
                  <button
                    key={sector}
                    onClick={() => { setBrandQuery(sector); setBrandInput(sector); setShowSectors(false) }}
                    className="px-3 py-1.5 rounded-full text-xs border transition-colors hover:border-white/30"
                    style={{
                      background: brandQuery === sector ? `${Y}22` : 'transparent',
                      borderColor: brandQuery === sector ? Y : BORDER,
                      color: brandQuery === sector ? Y : W50,
                    }}
                  >
                    {sector}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Age ranges */}
          <div className="mb-6">
            <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: W50 }}>
              Age Range <span style={{ color: W30 }}>(select all that apply)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {AGE_RANGES.map(age => (
                <button
                  key={age}
                  onClick={() => toggleAge(age)}
                  className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
                  style={{
                    background: selectedAges.includes(age) ? `${Y}22` : 'transparent',
                    borderColor: selectedAges.includes(age) ? Y : BORDER,
                    color: selectedAges.includes(age) ? Y : W50,
                  }}
                >
                  {age}
                </button>
              ))}
            </div>
          </div>

          {/* Gender */}
          <div className="mb-6">
            <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: W50 }}>
              Gender
            </label>
            <div className="flex gap-2">
              {(['any', 'female', 'male'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors capitalize"
                  style={{
                    background: gender === g ? `${Y}22` : 'transparent',
                    borderColor: gender === g ? Y : BORDER,
                    color: gender === g ? Y : W50,
                  }}
                >
                  {g === 'any' ? 'Any' : g === 'female' ? 'Female' : 'Male'}
                </button>
              ))}
            </div>
          </div>

          {/* Threshold — only show if age or gender is selected */}
          {(selectedAges.length > 0 || gender !== 'any') && (
            <div className="mb-6">
              <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: W50 }}>
                Minimum Audience Match — <span style={{ color: Y }}>{threshold}%</span>
              </label>
              <input
                type="range"
                min="5"
                max="60"
                step="5"
                value={threshold}
                onChange={e => setThreshold(parseInt(e.target.value))}
                className="w-full"
                style={{ accentColor: Y }}
              />
              <div className="flex justify-between text-xs mt-1" style={{ color: W30 }}>
                <span>5%</span>
                <span>30%</span>
                <span>60%</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={runSearch}
              disabled={loading || !hasFilters}
              className="px-6 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
              style={{ background: Y, color: BG }}
            >
              {loading ? 'Searching…' : 'Find Artists'}
            </button>
            {hasFilters && (
              <button onClick={clearAll} className="text-sm transition-colors" style={{ color: W30 }}>
                Clear all
              </button>
            )}
            {hasSearched && !loading && (
              <span className="text-sm ml-auto" style={{ color: W50 }}>
                {results.length} artists match
              </span>
            )}
          </div>
        </div>

        {/* Results */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: Y, borderTopColor: 'transparent' }} />
          </div>
        )}

        {!loading && hasSearched && results.length === 0 && (
          <div className="text-center py-16" style={{ color: W30 }}>
            <div className="text-4xl mb-3 opacity-30">🔍</div>
            <div className="text-sm">No artists match this brief. Try lowering the threshold or broadening the age range.</div>
          </div>
        )}

        {!loading && results.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs uppercase tracking-wider" style={{ color: W30 }}>
                Ranked by match score
              </div>
              <div className="flex items-center gap-4 text-xs" style={{ color: W30 }}>
                {(selectedAges.length > 0 || gender !== 'any') && (
                  <span style={{ color: GREEN }}>● Demographic match %</span>
                )}
                {brandQuery && <span style={{ color: Y }}>● Brand affinity</span>}
                <span style={{ color: Y }}>Score</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {results.map(artist => (
                <ResultCard
                  key={artist.chartmetric_id}
                  artist={artist}
                  query={{ brand: brandQuery, gender, ages: selectedAges }}
                  onClick={() => router.push(`/artists/${artist.chartmetric_id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {!hasSearched && (
          <div className="text-center py-16" style={{ color: W30 }}>
            <div className="text-4xl mb-3 opacity-20">🎯</div>
            <div className="text-sm mb-1" style={{ color: W50 }}>Set your brief above and hit Find Artists</div>
            <div className="text-xs">Use brand, demographic filters, or both</div>
          </div>
        )}

      </div>
    </div>
  )
}
