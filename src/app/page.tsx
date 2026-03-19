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
}

interface BrandSuggestion {
  name: string
  artist_count: number
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
  const score = artist.cm_score ? Math.round(artist.cm_score) : null

  return (
    <a onClick={onClick} className="cursor-pointer block" style={{ color: '#f5f4f2' }}>
      <div style={{ backgroundColor: '#1e1e1e' }}>
        {/* Photo container */}
        <div className="relative" style={{ aspectRatio: '1/1', backgroundColor: '#2a2a2a' }}>
          {artist.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artist.image_url} alt={artist.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center font-bold text-4xl" style={{ color: '#444' }}>
              {artist.name[0]}
            </div>
          )}
          {score !== null && (
            <div className="absolute font-bold" style={{ top: '8px', right: '8px', backgroundColor: 'rgba(27,27,27,0.9)', color: '#F9D40A', fontSize: '11px', fontWeight: 700, padding: '2px 6px' }}>
              {score}
            </div>
          )}
          <div className="absolute rounded-full" style={{ top: '10px', left: '8px', width: '7px', height: '7px', backgroundColor: getMomentumColor(artist.cm_score) }} />
        </div>

        {/* Info */}
        <div style={{ padding: '10px 12px 12px' }}>
          <div className="truncate" style={{ fontSize: '13px', fontWeight: 600, color: '#f5f4f2', marginBottom: '4px' }}>
            {artist.name}
          </div>
          <div className="flex" style={{ justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '10px', color: '#888' }}>{artist.career_stage ?? '—'}</span>
            <span style={{ fontSize: '10px', color: '#777' }}>{artist.primary_genre ?? ''}</span>
          </div>
          {/* Platform logos */}
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
  const [genre, setGenre] = useState('All Genres')
  const [genres, setGenres] = useState<string[]>([])
  const [brandFilter, setBrandFilter] = useState('')
  const [brandInput, setBrandInput] = useState('')
  const [brandSuggestions, setBrandSuggestions] = useState<BrandSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [sort, setSort] = useState<'score' | 'az' | 'reach'>('score')
  const brandInputRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout>()

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

  const handleSearchChange = (value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => setSearch(value), 300)
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0a0a0a', color: '#f5f4f2' }}>

      {/* NAV */}
      <nav
        className="flex items-center gap-4 px-6 border-b"
        style={{ backgroundColor: '#0a0a0a', borderColor: '#1f1f1f', height: '56px' }}
      >
        <div className="flex items-center gap-3 mr-2 shrink-0">
          <img src="/pty-logo.svg" alt="P&TY" className="h-8 w-auto" />
          <span className="font-bold text-sm tracking-wide hidden sm:block" style={{ color: '#fff' }}>
            BRAND INTELLIGENCE
          </span>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <input
            placeholder="Search artists..."
            onChange={e => handleSearchChange(e.target.value)}
            className="w-full px-4 py-2 rounded text-sm placeholder-gray-600 border border-gray-800 focus:outline-none focus:border-gray-600"
            style={{ backgroundColor: '#141414', color: '#fff' }}
          />
        </div>

        {/* Genre */}
        <select
          value={genre}
          onChange={e => setGenre(e.target.value)}
          className="px-3 py-2 rounded text-sm border border-gray-800 focus:outline-none cursor-pointer"
          style={{ backgroundColor: '#141414', color: '#fff' }}
        >
          <option>All Genres</option>
          {genres.map(g => <option key={g}>{g}</option>)}
        </select>

        {/* Brand filter */}
        <div className="relative hidden lg:block">
          <input
            ref={brandInputRef}
            placeholder="Filter by brand..."
            value={brandInput}
            onChange={e => setBrandInput(e.target.value)}
            onFocus={() => brandSuggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            className="w-40 px-3 py-2 rounded text-sm placeholder-gray-600 border border-gray-800 focus:outline-none focus:border-gray-600"
            style={{ backgroundColor: '#141414', color: '#fff' }}
          />
          {showSuggestions && brandSuggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded border overflow-hidden z-20"
              style={{ backgroundColor: '#141414', borderColor: '#2a2a2a' }}>
              {brandSuggestions.map((b, i) => (
                <button key={i}
                  onMouseDown={() => { setBrandFilter(b.name); setBrandInput(b.name); setShowSuggestions(false) }}
                  className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-gray-800 transition-colors">
                  <span className="text-xs font-semibold text-white">{b.name}</span>
                  <span className="text-xs" style={{ color: '#6b7280' }}>{b.artist_count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Active brand chip */}
        {brandFilter && (
          <button
            onClick={() => { setBrandFilter(''); setBrandInput('') }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold shrink-0"
            style={{ backgroundColor: '#F9D40A', color: '#0a0a0a' }}
          >
            {brandFilter} <span className="opacity-60 ml-0.5">✕</span>
          </button>
        )}

        {/* Sort — v1 style: SCORE = yellow filled, A-Z/REACH = plain text */}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <button
            onClick={() => setSort('score')}
            className="px-4 py-1.5 text-xs font-bold tracking-widest rounded"
            style={{
              backgroundColor: sort === 'score' ? '#F9D40A' : 'transparent',
              color: sort === 'score' ? '#0a0a0a' : '#888',
            }}
          >
            SCORE
          </button>
          <button
            onClick={() => setSort('az')}
            className="px-3 py-1.5 text-xs font-bold tracking-widest"
            style={{ color: sort === 'az' ? '#fff' : '#888' }}
          >
            A-Z
          </button>
          <button
            onClick={() => setSort('reach')}
            className="px-3 py-1.5 text-xs font-bold tracking-widest"
            style={{ color: sort === 'reach' ? '#fff' : '#888' }}
          >
            REACH
          </button>
        </div>
      </nav>

      {/* Artist count */}
      <div className="px-6 py-3">
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#888', letterSpacing: '0.05em' }}>
          {artists.length} ARTISTS
        </span>
      </div>

      {/* GRID — 2px gap matching v1 exactly */}
      <div className="px-6 pb-10">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: '#F9D40A', borderTopColor: 'transparent' }} />
          </div>
        ) : artists.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64" style={{ color: '#6b7280' }}>
            <div className="text-4xl mb-3 opacity-30">🔍</div>
            <div className="text-sm">No artists found</div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
              gap: '2px',
            }}
          >
            {artists.map(artist => (
              <ArtistCard
                key={artist.chartmetric_id}
                artist={artist}
                onClick={() => router.push(`/artists/${artist.chartmetric_id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
