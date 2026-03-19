'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ── Types ─────────────────────────────────────────────
interface Artist {
  chartmetric_id: number
  name: string
  image_url: string | null
  career_stage: string | null
  cm_score: number | null
  spotify_followers: number | null
  instagram_followers: number | null
  tiktok_followers: number | null
  primary_genre: string | null
  audience_male_pct: number | null
  audience_female_pct: number | null
  age_18_24_pct: number | null
  age_25_34_pct: number | null
  age_35_44_pct: number | null
  top_countries: any[] | null
  brand_match?: {
    brand_name: string
    affinity_scale: number
    follower_count: number
  }
}

interface ArtistDetail {
  artist: Artist
  brands: { brand_name: string; affinity_scale: number; follower_count: number }[]
  sectors: { sector_name: string; affinity_scale: number }[]
  deals: {
    artist_name: string
    tour: string | null
    stage: string | null
    close_probability: number | null
    first_show: string | null
    last_show: string | null
    proj_gross: number | null
  }[]
}

interface BrandSuggestion {
  name: string
  artist_count: number
}

// ── Helpers ───────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toLocaleString()
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n * 100).toFixed(0) + '%'
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Components ────────────────────────────────────────
function PTYLogo({ className = '' }: { className?: string }) {
  return (
    <img src="/pty-logo.svg" alt="P&TY" className={className} />
  )
}

function Spinner() {
  return (
    <div className="w-5 h-5 rounded-full border-2 border-[#dfdedc] border-t-[#F9D40A] animate-spin" />
  )
}

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'yellow' | 'blue' }) {
  const styles = {
    default: 'bg-[#f5f4f2] border-[#dfdedc] text-[#737271]',
    yellow: 'bg-[#F9D40A]/15 border-[#F9D40A]/40 text-[#7a6800]',
    blue: 'bg-[#345d83]/15 border-[#345d83]/30 text-[#345d83]',
  }
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border ${styles[variant]}`}>
      {children}
    </span>
  )
}

function AffinityBar({ value, max = 3 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-1.5 bg-[#1B1B1B]/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: value >= 2 ? '#F9D40A' : value >= 1.5 ? '#345d83' : '#9c9b99',
          }}
        />
      </div>
      <span className="text-[11px] font-semibold text-[#4c4c4c] tabular-nums w-8 text-right">
        {value.toFixed(1)}x
      </span>
    </div>
  )
}

// ── Artist Card ───────────────────────────────────────
function ArtistCard({
  artist,
  index,
  isSelected,
  onClick,
}: {
  artist: Artist
  index: number
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left group rounded-xl border transition-all duration-200 p-4
        ${isSelected
          ? 'border-[#F9D40A] bg-white shadow-[0_0_0_1px_#F9D40A]'
          : 'border-[#e8e7e5] bg-white hover:border-[#bbbbb9] hover:shadow-sm'
        }`}
      style={{
        animation: `fadeSlideIn 0.3s ease-out ${index * 0.04}s both`,
      }}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-11 h-11 rounded-full bg-[#1B1B1B] flex-shrink-0 overflow-hidden flex items-center justify-center">
          {artist.image_url ? (
            <img src={artist.image_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[#F9D40A] font-bold text-sm">
              {artist.name.charAt(0)}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[14px] text-[#1B1B1B] truncate">
              {artist.name}
            </h3>
            {artist.cm_score && artist.cm_score > 70 && (
              <Badge variant="yellow">HOT</Badge>
            )}
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            {artist.primary_genre && (
              <span className="text-[11px] text-[#9c9b99] font-medium">{artist.primary_genre}</span>
            )}
            {artist.career_stage && (
              <>
                <span className="text-[#dfdedc]">·</span>
                <span className="text-[11px] text-[#9c9b99] font-medium capitalize">{artist.career_stage}</span>
              </>
            )}
          </div>

          {/* Social stats row */}
          <div className="flex items-center gap-3 mt-2">
            {artist.spotify_followers && (
              <div className="flex items-center gap-1">
                <svg className="w-3 h-3 text-[#1DB954]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                <span className="text-[11px] font-semibold text-[#4c4c4c]">{fmt(artist.spotify_followers)}</span>
              </div>
            )}
            {artist.instagram_followers && (
              <div className="flex items-center gap-1">
                <svg className="w-3 h-3 text-[#E4405F]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                </svg>
                <span className="text-[11px] font-semibold text-[#4c4c4c]">{fmt(artist.instagram_followers)}</span>
              </div>
            )}
            {artist.tiktok_followers && (
              <div className="flex items-center gap-1">
                <svg className="w-3 h-3 text-[#000]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.46V13a8.24 8.24 0 005.58 2.17V11.7a4.85 4.85 0 01-2.98-1.01V6.69h2.98z"/>
                </svg>
                <span className="text-[11px] font-semibold text-[#4c4c4c]">{fmt(artist.tiktok_followers)}</span>
              </div>
            )}
          </div>

          {/* Brand match pill */}
          {artist.brand_match && (
            <div className="flex items-center gap-2 mt-2 px-2 py-1 rounded-lg bg-[#F9D40A]/10 border border-[#F9D40A]/25">
              <span className="text-[10px] font-bold text-[#7a6800] uppercase tracking-wider">
                {artist.brand_match.brand_name}
              </span>
              <AffinityBar value={artist.brand_match.affinity_scale} />
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

// ── Detail Panel ──────────────────────────────────────
function DetailPanel({ detail, onClose }: { detail: ArtistDetail | null; onClose: () => void }) {
  if (!detail) return null
  const { artist, brands, sectors, deals } = detail

  return (
    <div className="h-full flex flex-col bg-white animate-slideIn">
      {/* Header */}
      <div className="p-5 border-b border-[#e8e7e5]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-[#1B1B1B] overflow-hidden flex items-center justify-center flex-shrink-0">
              {artist.image_url ? (
                <img src={artist.image_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[#F9D40A] font-bold text-lg">{artist.name.charAt(0)}</span>
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1B1B1B] leading-tight">{artist.name}</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                {artist.primary_genre && (
                  <Badge>{artist.primary_genre}</Badge>
                )}
                {artist.career_stage && (
                  <Badge variant="blue">{artist.career_stage}</Badge>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[#9c9b99] hover:bg-[#f5f4f2] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="text-center p-2 rounded-lg bg-[#f5f4f2]">
            <div className="text-[11px] text-[#9c9b99] font-medium">Spotify</div>
            <div className="text-[14px] font-bold text-[#1B1B1B]">{fmt(artist.spotify_followers)}</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-[#f5f4f2]">
            <div className="text-[11px] text-[#9c9b99] font-medium">Instagram</div>
            <div className="text-[14px] font-bold text-[#1B1B1B]">{fmt(artist.instagram_followers)}</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-[#f5f4f2]">
            <div className="text-[11px] text-[#9c9b99] font-medium">TikTok</div>
            <div className="text-[14px] font-bold text-[#1B1B1B]">{fmt(artist.tiktok_followers)}</div>
          </div>
        </div>

        {/* Demographics */}
        {(artist.audience_male_pct || artist.audience_female_pct) && (
          <div className="mt-3">
            <div className="text-[10px] text-[#9c9b99] font-bold uppercase tracking-wider mb-1.5">Audience</div>
            <div className="flex items-center gap-1 h-2 rounded-full overflow-hidden bg-[#f5f4f2]">
              {artist.audience_male_pct && (
                <div
                  className="h-full bg-[#345d83] rounded-full transition-all duration-500"
                  style={{ width: `${(artist.audience_male_pct * 100)}%` }}
                />
              )}
              {artist.audience_female_pct && (
                <div
                  className="h-full bg-[#E4405F] rounded-full transition-all duration-500"
                  style={{ width: `${(artist.audience_female_pct * 100)}%` }}
                />
              )}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-[#345d83] font-semibold">♂ {fmtPct(artist.audience_male_pct)}</span>
              <span className="text-[10px] text-[#E4405F] font-semibold">♀ {fmtPct(artist.audience_female_pct)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Deals */}
        {deals.length > 0 && (
          <div className="p-5 border-b border-[#e8e7e5]">
            <h3 className="text-[10px] text-[#9c9b99] font-bold uppercase tracking-wider mb-3">P&TY Deals</h3>
            <div className="space-y-2">
              {deals.map((deal, i) => (
                <div key={i} className="p-3 rounded-lg bg-[#f5f4f2] border border-[#e8e7e5]">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-[#1B1B1B]">
                      {deal.tour || deal.artist_name}
                    </span>
                    {deal.close_probability != null && (
                      <Badge variant={deal.close_probability >= 80 ? 'yellow' : 'default'}>
                        {deal.close_probability}%
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-[#737271]">
                    {deal.stage && <span>{deal.stage}</span>}
                    {deal.first_show && (
                      <>
                        <span className="text-[#dfdedc]">·</span>
                        <span>{fmtDate(deal.first_show)} → {fmtDate(deal.last_show)}</span>
                      </>
                    )}
                  </div>
                  {deal.proj_gross != null && (
                    <div className="text-[11px] font-semibold text-[#4c4c4c] mt-1">
                      Proj Gross: {fmtCurrency(deal.proj_gross)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Brand Affinities */}
        {brands.length > 0 && (
          <div className="p-5 border-b border-[#e8e7e5]">
            <h3 className="text-[10px] text-[#9c9b99] font-bold uppercase tracking-wider mb-3">
              Brand Affinities ({brands.length})
            </h3>
            <div className="space-y-1.5">
              {brands.slice(0, 20).map((b, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 py-1"
                  style={{ animation: `fadeSlideIn 0.2s ease-out ${i * 0.03}s both` }}
                >
                  <span className="text-[12px] font-medium text-[#1B1B1B] w-32 truncate flex-shrink-0">
                    {b.brand_name}
                  </span>
                  <AffinityBar value={b.affinity_scale} />
                </div>
              ))}
              {brands.length > 20 && (
                <div className="text-[11px] text-[#9c9b99] font-medium pt-1">
                  + {brands.length - 20} more brands
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sector Interests */}
        {sectors.length > 0 && (
          <div className="p-5">
            <h3 className="text-[10px] text-[#9c9b99] font-bold uppercase tracking-wider mb-3">
              Audience Interests ({sectors.length})
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {sectors.slice(0, 15).map((s, i) => (
                <span
                  key={i}
                  className="text-[11px] font-medium px-2 py-1 rounded-full bg-[#f5f4f2] border border-[#e8e7e5] text-[#4c4c4c]"
                  style={{ animation: `fadeSlideIn 0.2s ease-out ${i * 0.03}s both` }}
                >
                  {s.sector_name} <span className="text-[#9c9b99]">{s.affinity_scale.toFixed(1)}x</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────
export default function RosterPage() {
  const [artists, setArtists] = useState<Artist[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [brandInput, setBrandInput] = useState('')
  const [brandSuggestions, setBrandSuggestions] = useState<BrandSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ArtistDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const brandInputRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout>()

  // Fetch artists
  const fetchArtists = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (brandFilter) params.set('brand', brandFilter)
      params.set('limit', '50')

      const res = await fetch(`/api/artists?${params}`)
      const data = await res.json()
      setArtists(data.artists || [])
      setTotalCount(data.count || 0)
    } catch (err) {
      console.error('Failed to fetch artists:', err)
    }
    setLoading(false)
  }, [search, brandFilter])

  useEffect(() => {
    fetchArtists()
  }, [fetchArtists])

  // Brand autocomplete
  useEffect(() => {
    if (brandInput.length < 2) {
      setBrandSuggestions([])
      return
    }

    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/brands?q=${encodeURIComponent(brandInput)}`)
        const data = await res.json()
        setBrandSuggestions(data.brands || [])
        setShowSuggestions(true)
      } catch {}
    }, 200)

    return () => clearTimeout(timeout)
  }, [brandInput])

  // Fetch artist detail
  const selectArtist = async (cmId: number) => {
    if (selectedId === cmId) {
      setSelectedId(null)
      setDetail(null)
      return
    }
    setSelectedId(cmId)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/artists/${cmId}`)
      const data = await res.json()
      setDetail(data)
    } catch (err) {
      console.error('Failed to fetch detail:', err)
    }
    setDetailLoading(false)
  }

  // Debounced search
  const handleSearchChange = (value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => setSearch(value), 300)
  }

  return (
    <div className="min-h-screen bg-[#f5f4f2]">
      {/* Top Nav */}
      <nav className="fixed top-0 left-0 right-0 h-14 bg-[#1B1B1B] flex items-center px-5 z-50">
        <PTYLogo className="h-5" />
        <div className="ml-3 flex items-baseline gap-2">
          <span className="text-white text-[13px] font-bold tracking-tight">Brand Intelligence</span>
          <span className="text-[#737271] text-[11px] font-medium hidden sm:inline">v2.0</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-[11px] text-[#737271] font-medium hidden md:block">
            {totalCount} artists
          </div>
          <div className="w-7 h-7 rounded-full bg-[#F9D40A] flex items-center justify-center text-[#1B1B1B] text-[11px] font-extrabold">
            P
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="pt-14 flex h-screen">
        {/* Left panel — roster list */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Search & Filter bar */}
          <div className="p-4 border-b border-[#e8e7e5] bg-white/80 backdrop-blur-sm sticky top-14 z-10">
            <div className="flex gap-2">
              {/* Artist search */}
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#bbbbb9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search artists..."
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#e8e7e5] bg-[#f5f4f2] text-[13px] font-medium text-[#1B1B1B] placeholder-[#bbbbb9] outline-none focus:border-[#F9D40A] focus:ring-1 focus:ring-[#F9D40A]/30 transition-all"
                />
              </div>

              {/* Brand filter */}
              <div className="relative w-48">
                <input
                  ref={brandInputRef}
                  type="text"
                  placeholder="Filter by brand..."
                  value={brandInput}
                  onChange={(e) => setBrandInput(e.target.value)}
                  onFocus={() => brandSuggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="w-full h-9 px-3 rounded-lg border border-[#e8e7e5] bg-[#f5f4f2] text-[13px] font-medium text-[#1B1B1B] placeholder-[#bbbbb9] outline-none focus:border-[#F9D40A] focus:ring-1 focus:ring-[#F9D40A]/30 transition-all"
                />

                {/* Brand suggestions dropdown */}
                {showSuggestions && brandSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg border border-[#e8e7e5] shadow-lg overflow-hidden z-20 animate-dropIn">
                    {brandSuggestions.map((b, i) => (
                      <button
                        key={i}
                        className="w-full px-3 py-2 text-left hover:bg-[#f5f4f2] transition-colors flex items-center justify-between"
                        onMouseDown={() => {
                          setBrandFilter(b.name)
                          setBrandInput(b.name)
                          setShowSuggestions(false)
                        }}
                      >
                        <span className="text-[12px] font-semibold text-[#1B1B1B]">{b.name}</span>
                        <span className="text-[10px] text-[#9c9b99]">{b.artist_count} artists</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Active filter chips */}
            {brandFilter && (
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => {
                    setBrandFilter('')
                    setBrandInput('')
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-full bg-[#1B1B1B] text-white text-[11px] font-semibold hover:bg-[#4c4c4c] transition-colors"
                >
                  {brandFilter}
                  <span className="ml-0.5 opacity-60">✕</span>
                </button>
              </div>
            )}
          </div>

          {/* Artist list */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Spinner />
              </div>
            ) : artists.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="text-3xl mb-2 opacity-30">🔍</div>
                <div className="text-[13px] text-[#9c9b99] font-medium">No artists found</div>
              </div>
            ) : (
              <div className="space-y-2 max-w-2xl">
                {artists.map((artist, i) => (
                  <ArtistCard
                    key={artist.chartmetric_id}
                    artist={artist}
                    index={i}
                    isSelected={selectedId === artist.chartmetric_id}
                    onClick={() => selectArtist(artist.chartmetric_id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — detail */}
        <div className={`w-[420px] border-l border-[#e8e7e5] bg-white flex-shrink-0 hidden lg:flex flex-col transition-all duration-300 ${selectedId ? 'opacity-100' : 'opacity-50'}`}>
          {detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Spinner />
            </div>
          ) : detail ? (
            <DetailPanel detail={detail} onClose={() => { setSelectedId(null); setDetail(null) }} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <div className="text-4xl mb-3 opacity-20">👈</div>
              <div className="text-[13px] text-[#bbbbb9] font-medium">
                Select an artist to view brand affinities, audience demographics, and deal history
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
