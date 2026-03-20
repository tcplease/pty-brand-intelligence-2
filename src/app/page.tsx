'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

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
  is_dimmed?: boolean
}

interface BrandSuggestion {
  name: string
  artist_count: number
}

// ── Brand colors ──────────────────────────────────────
const Y = '#F9D40A'
const BG = '#1B1B1B'
const SURFACE = '#1e1e1e'
const BORDER = 'rgba(255,255,255,0.08)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'
const GREEN = '#00D26A'
const BLUE = '#4A9EFF'

const CAREER_COLORS: Record<string, string> = {
  legendary: '#ef4444',
  superstar: '#f97316',
  mainstream: '#F9D40A',
  'mid-level': '#00D26A',
  developing: '#4A9EFF',
  undiscovered: 'rgba(255,255,255,0.3)',
}

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

function ArtistCard({ artist, onClick }: { artist: Artist; onClick: () => void }) {
  const score = artist.cm_score ? Math.round(Number(artist.cm_score)) : null
  const careerColor = CAREER_COLORS[artist.career_stage?.toLowerCase() ?? ''] ?? W50

  return (
    <a onClick={onClick} className="cursor-pointer block" style={{ color: '#f5f4f2', opacity: artist.is_dimmed ? 0.4 : 1 }}>
      <div style={{ backgroundColor: SURFACE, borderRadius: '8px', overflow: 'hidden', border: `1px solid ${BORDER}` }}>
        <div className="relative" style={{ aspectRatio: '4/3', backgroundColor: '#2a2a2a' }}>
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

        <div style={{ padding: '10px 12px 12px' }}>
          <div className="truncate" style={{ fontSize: '13px', fontWeight: 600, color: '#f5f4f2', marginBottom: '4px' }}>
            {artist.name}
          </div>
          <div className="flex items-center" style={{ gap: '4px', marginBottom: '6px' }}>
            {artist.career_stage && (
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                padding: '2px 7px',
                borderRadius: '4px',
                background: `${careerColor}15`,
                color: careerColor,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {artist.career_stage}
              </span>
            )}
            {artist.primary_genre && (
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                padding: '2px 7px',
                borderRadius: '4px',
                background: 'rgba(255,255,255,0.07)',
                color: W50,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {artist.primary_genre}
              </span>
            )}
          </div>
          <div className="flex items-center" style={{ gap: '8px' }}>
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
    </a>
  )
}

export default function RosterPage() {
  const router = useRouter()
  const [allArtists, setAllArtists] = useState<Artist[]>([])
  const [artists, setArtists] = useState<Artist[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [genre, setGenre] = useState('All Genres')
  const [genres, setGenres] = useState<string[]>([])
  const [brandFilter, setBrandFilter] = useState('')
  const [brandInput, setBrandInput] = useState('')
  const [brandSuggestions, setBrandSuggestions] = useState<BrandSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [sort, setSort] = useState<'score' | 'az' | 'reach'>('score')
  const [showFilterDrawer, setShowFilterDrawer] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const brandInputRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout>()
  const mobileSearchRef = useRef<HTMLInputElement>(null)

  const activeFilterCount = [
    genre !== 'All Genres',
    !!brandFilter,
    sort !== 'score',
  ].filter(Boolean).length

  const hasActiveFilters = genre !== 'All Genres' || !!brandFilter

  const fetchArtists = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (brandFilter) params.set('brand', brandFilter)
      if (search) params.set('search', search)
      params.set('limit', '500')
      const res = await fetch(`/api/artists?${params}`)
      const data = await res.json()
      const list: Artist[] = data.artists || []
      setAllArtists(list)
      if (!brandFilter && !search) {
        const gs = new Set(list.map((a: Artist) => a.primary_genre).filter(Boolean) as string[])
        setGenres(Array.from(gs).sort())
      }
    } catch (err) { console.error(err) }
    setLoading(false)
  }, [search, brandFilter])

  useEffect(() => { fetchArtists() }, [fetchArtists])

  useEffect(() => {
    let result = [...allArtists]
    if (genre !== 'All Genres') result = result.filter(a => a.primary_genre === genre)
    if (sort === 'score') result.sort((a, b) => (b.cm_score ?? 0) - (a.cm_score ?? 0))
    if (sort === 'az') result.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'reach') result.sort((a, b) => (b.spotify_followers ?? 0) - (a.spotify_followers ?? 0))
    setArtists(result)
  }, [allArtists, genre, sort])

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

  const clearBrand = () => {
    setBrandFilter('')
    setBrandInput('')
    setBrandSuggestions([])
  }

  const handleSearch = (value: string) => {
    setSearchInput(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => setSearch(value), 300)
  }

  return (
    <div className="min-h-screen" style={{ background: BG, fontFamily: 'system-ui, sans-serif' }}>

      {/* NAV */}
      <nav className="flex items-center px-4 md:px-6 py-3 border-b sticky top-0 z-50"
        style={{ background: BG, borderColor: BORDER }}>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-4 w-full">
          <img src="/pty-logo.svg" alt="P&TY" className="h-7 w-auto shrink-0" />
          <div className="h-4 w-px shrink-0" style={{ backgroundColor: BORDER }} />
          <a href="/" className="text-sm font-medium" style={{ color: Y }}>Roster</a>
          <a href="/discovery" className="text-sm transition-colors hover:text-white" style={{ color: W50 }}>Discovery</a>
          <a href="/brand-search" className="text-sm transition-colors hover:text-white" style={{ color: W50 }}>Brand Search</a>

          <div className="flex-1" />

          {/* Desktop search */}
          <div className="relative">
            <input
              placeholder="Search artists..."
              value={searchInput}
              onChange={e => handleSearch(e.target.value)}
              className="px-3 py-1.5 rounded-lg border text-xs outline-none w-48"
              style={{ background: '#1C1C1C', borderColor: BORDER, color: '#fff' }}
            />
          </div>

          {/* Desktop genre filter */}
          <select value={genre} onChange={e => setGenre(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: '#1C1C1C', borderColor: BORDER, color: 'rgba(255,255,255,0.8)' }}>
            <option>All Genres</option>
            {genres.map(g => <option key={g}>{g}</option>)}
          </select>

          {/* Desktop brand filter */}
          <div className="relative">
            <input
              ref={brandInputRef}
              placeholder="Brand affinity..."
              value={brandInput}
              onChange={e => setBrandInput(e.target.value)}
              onFocus={() => brandSuggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              className="px-3 py-1.5 rounded-lg border text-xs outline-none w-40"
              style={{ background: '#1C1C1C', borderColor: brandFilter ? Y : BORDER, color: '#fff' }}
            />
            {brandFilter && (
              <button onClick={clearBrand} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#888' }}>✕</button>
            )}
            {showSuggestions && brandSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border overflow-hidden z-20"
                style={{ backgroundColor: SURFACE, borderColor: '#2a2a2a' }}>
                {brandSuggestions.slice(0, 5).map((b, i) => (
                  <button key={i} onMouseDown={() => { setBrandFilter(b.name); setBrandInput(b.name); setShowSuggestions(false) }}
                    className="w-full px-3 py-2 text-left flex items-center justify-between border-b last:border-0 hover:bg-white/5"
                    style={{ borderColor: '#2a2a2a' }}>
                    <span className="text-xs text-white">{b.name}</span>
                    <span className="text-[10px]" style={{ color: '#6b7280' }}>{b.artist_count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Desktop sort */}
          <select value={sort} onChange={e => setSort(e.target.value as any)}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: '#1C1C1C', borderColor: BORDER, color: 'rgba(255,255,255,0.8)' }}>
            <option value="score">CM Score</option>
            <option value="az">A–Z</option>
            <option value="reach">Reach</option>
          </select>
        </div>

        {/* Mobile nav */}
        <div className="flex md:hidden items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <img src="/pty-logo.svg" alt="P&TY" className="h-6 w-auto" />
            <div className="h-4 w-px" style={{ backgroundColor: BORDER }} />
            <a href="/" className="text-sm font-medium" style={{ color: Y }}>Roster</a>
            <a href="/discovery" className="text-sm" style={{ color: W50 }}>Discovery</a>
          </div>
          <>
            {/* Search icon */}
            <button onClick={() => {
              setShowMobileSearch(!showMobileSearch)
              setTimeout(() => mobileSearchRef.current?.focus(), 100)
            }} className="p-2" style={{ color: search ? Y : '#888' }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
            {/* Filter icon with badge */}
            <button onClick={() => setShowFilterDrawer(true)} className="p-2 relative" style={{ color: activeFilterCount > 0 ? Y : '#888' }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 12h10M11 20h2" />
              </svg>
              {activeFilterCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full text-xs font-bold flex items-center justify-center"
                  style={{ backgroundColor: Y, color: '#0a0a0a', fontSize: '9px' }}>
                  {activeFilterCount}
                </span>
              )}
            </button>
          </>
        </div>
      </nav>

      {/* Mobile search bar */}
      {showMobileSearch && (
        <div className="md:hidden px-4 py-2 border-b" style={{ borderColor: BORDER, background: BG }}>
          <input
            ref={mobileSearchRef}
            placeholder="Search artists..."
            value={searchInput}
            onChange={e => handleSearch(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ background: '#1C1C1C', borderColor: BORDER, color: '#fff' }}
          />
        </div>
      )}

      {/* Active filter chips — mobile only */}
      {(brandFilter || genre !== 'All Genres') && (
        <div className="flex md:hidden items-center gap-2 px-4 py-2 border-b flex-wrap"
          style={{ borderColor: BORDER }}>
          {brandFilter && (
            <button onClick={clearBrand}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
              style={{ backgroundColor: Y, color: '#0a0a0a' }}>
              {brandFilter} <span className="opacity-60">✕</span>
            </button>
          )}
          {genre !== 'All Genres' && (
            <button onClick={() => setGenre('All Genres')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border"
              style={{ borderColor: Y, color: Y }}>
              {genre} <span className="opacity-60">✕</span>
            </button>
          )}
        </div>
      )}

      {/* Artist count */}
      <div className="px-4 md:px-6 py-3">
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#888', letterSpacing: '0.05em' }}>
          {artists.length} ARTISTS
        </span>
      </div>

      {/* GRID */}
      <div className="px-2 md:px-6 pb-10">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: Y, borderTopColor: 'transparent' }} />
          </div>
        ) : artists.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64" style={{ color: '#6b7280' }}>
            <div className="text-4xl mb-3 opacity-30">🔍</div>
            <div className="text-sm">No artists found</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px' }}>
            {artists.map(artist => (
              <ArtistCard key={artist.chartmetric_id} artist={artist}
                onClick={() => router.push(`/artists/${artist.chartmetric_id}`)} />
            ))}
          </div>
        )}
      </div>

      {/* ── MOBILE FILTER DRAWER ── */}
      {showFilterDrawer && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 md:hidden" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
            onClick={() => setShowFilterDrawer(false)} />

          {/* Drawer */}
          <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden rounded-t-2xl border-t"
            style={{ backgroundColor: '#141414', borderColor: '#2a2a2a' }}>
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ backgroundColor: '#333' }} />
            </div>

            <div className="px-5 pb-8 pt-2">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-white">Filters & Sort</h3>
                {hasActiveFilters && (
                  <button onClick={() => { setGenre('All Genres'); clearBrand() }}
                    className="text-xs" style={{ color: '#888' }}>
                    Clear all
                  </button>
                )}
              </div>

              {/* Genre */}
              <div className="mb-5">
                <label className="text-xs uppercase tracking-wider mb-2 block" style={{ color: '#888' }}>Genre</label>
                <select value={genre} onChange={e => setGenre(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl text-sm border focus:outline-none"
                  style={{ backgroundColor: SURFACE, borderColor: '#2a2a2a', color: '#fff' }}>
                  <option>All Genres</option>
                  {genres.map(g => <option key={g}>{g}</option>)}
                </select>
              </div>

              {/* Brand */}
              <div className="mb-5">
                <label className="text-xs uppercase tracking-wider mb-2 block" style={{ color: '#888' }}>Brand Affinity</label>
                <div className="relative">
                  <input placeholder="Filter by brand..." value={brandInput}
                    onChange={e => setBrandInput(e.target.value)}
                    onFocus={() => brandSuggestions.length > 0 && setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    className="w-full px-3 py-3 rounded-xl text-sm border focus:outline-none"
                    style={{ backgroundColor: SURFACE, borderColor: brandFilter ? Y : '#2a2a2a', color: '#fff' }} />
                  {showSuggestions && brandSuggestions.length > 0 && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 rounded-xl border overflow-hidden z-20"
                      style={{ backgroundColor: SURFACE, borderColor: '#2a2a2a' }}>
                      {brandSuggestions.slice(0, 5).map((b, i) => (
                        <button key={i} onMouseDown={() => { setBrandFilter(b.name); setBrandInput(b.name); setShowSuggestions(false) }}
                          className="w-full px-4 py-3 text-left flex items-center justify-between border-b last:border-0"
                          style={{ borderColor: '#2a2a2a' }}>
                          <span className="text-sm text-white">{b.name}</span>
                          <span className="text-xs" style={{ color: '#6b7280' }}>{b.artist_count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Sort */}
              <div className="mb-6">
                <label className="text-xs uppercase tracking-wider mb-2 block" style={{ color: '#888' }}>Sort By</label>
                <div className="flex gap-2">
                  {(['score', 'az', 'reach'] as const).map(s => (
                    <button key={s} onClick={() => setSort(s)}
                      className="flex-1 py-3 rounded-xl text-sm font-bold border transition-colors"
                      style={{
                        backgroundColor: sort === s ? Y : 'transparent',
                        borderColor: sort === s ? Y : '#2a2a2a',
                        color: sort === s ? '#0a0a0a' : '#888',
                      }}>
                      {s === 'score' ? 'Score' : s === 'az' ? 'A–Z' : 'Reach'}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={() => setShowFilterDrawer(false)}
                className="w-full py-3 rounded-xl text-sm font-bold"
                style={{ backgroundColor: Y, color: '#0a0a0a' }}>
                Show {artists.length} Artists
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
