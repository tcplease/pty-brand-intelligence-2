'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Brand colors ──────────────────────────────────────
const Y = '#F9D40A'
const BG = '#1B1B1B'
const SURFACE = '#242424'
const SURFACE2 = '#1C1C1C'
const BORDER = 'rgba(255,255,255,0.08)'
const W80 = 'rgba(255,255,255,0.8)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'
const GREEN = '#00D26A'
const BLUE = '#4A9EFF'

const CAREER_COLORS: Record<string, string> = {
  superstar: Y,
  legendary: Y,
  mainstream: BLUE,
  'mid-level': GREEN,
  developing: W50,
  undiscovered: W30,
}

// ── Types ─────────────────────────────────────────────
interface Festival {
  festival_name: string
  festival_date: string | null
  festival_size: string | null
  festival_location: string | null
}

interface DiscoveryArtist {
  chartmetric_id: number
  name: string
  image_url: string | null
  career_stage: string | null
  cm_score: number | null
  primary_genre: string | null
  spotify_followers: number | null
  instagram_followers: number | null
  tiktok_followers: number | null
  created_at: string
  festivals: Festival[]
  festival_count: number
}

// ── Helpers ───────────────────────────────────────────
function fmt(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function uniqueFestivals(festivals: Festival[]): Festival[] {
  const seen = new Set<string>()
  return festivals.filter(f => {
    // Dedupe by base name (strip "Weekend One/Two" variants)
    const base = f.festival_name.replace(/\s*\(Weekend (One|Two)\)\s*/i, '').trim()
    if (seen.has(base)) return false
    seen.add(base)
    return true
  })
}

function primaryGenre(genre: string | null): string {
  if (!genre) return ''
  // Chartmetric returns comma-separated genres — just take the first
  return genre.split(',')[0].trim()
}

// ── Badge ─────────────────────────────────────────────
function Badge({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border"
      style={{
        background: `${color || W50}15`,
        borderColor: `${color || W50}30`,
        color: color || W50,
      }}
    >
      {children}
    </span>
  )
}

// ── Spinner ───────────────────────────────────────────
function Spinner() {
  return <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: Y, borderTopColor: 'transparent' }} />
}

// ── Artist Card ───────────────────────────────────────
function ArtistCard({
  artist,
  index,
  onDismiss,
  onNavigate,
}: {
  artist: DiscoveryArtist
  index: number
  onDismiss: (id: number) => void
  onNavigate: (id: number) => void
}) {
  const [dismissing, setDismissing] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const careerColor = CAREER_COLORS[artist.career_stage?.toLowerCase() ?? ''] ?? W50
  const fests = uniqueFestivals(artist.festivals)
  const genre = primaryGenre(artist.primary_genre)

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all duration-200 hover:border-white/15 cursor-pointer group"
      style={{
        background: SURFACE,
        borderColor: BORDER,
        maxWidth: 340,
        animation: `fadeIn 0.3s ease-out ${index * 0.04}s both`,
      }}
      onClick={() => onNavigate(artist.chartmetric_id)}
    >
      {/* Image */}
      <div className="relative h-40 overflow-hidden">
        {artist.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist.image_url}
            alt={artist.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl font-bold"
            style={{ background: BG, color: W30 }}>
            {artist.name[0]}
          </div>
        )}
        {/* Bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-20" style={{ background: 'linear-gradient(to top, #242424 0%, transparent 100%)' }} />

        {/* CM Score top-left */}
        {artist.cm_score != null && (
          <div className="absolute top-2.5 left-2.5 text-xs font-bold px-2 py-0.5 rounded-md"
            style={{ background: 'rgba(0,0,0,0.75)', color: Y, backdropFilter: 'blur(4px)' }}>
            {Math.round(artist.cm_score)}
          </div>
        )}

        {/* Festival count top-right */}
        {artist.festival_count > 1 && (
          <div className="absolute top-2.5 right-2.5 text-[10px] font-bold px-2 py-0.5 rounded-md"
            style={{ background: Y, color: BG }}>
            {artist.festival_count} festivals
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-3.5 pb-3.5 -mt-1">
        {/* Name + badges */}
        <h3 className="text-[15px] font-bold text-white leading-tight truncate mb-1">{artist.name}</h3>
        <div className="flex items-center gap-1.5 mb-2.5">
          {artist.career_stage && (
            <Badge color={careerColor}>{artist.career_stage}</Badge>
          )}
          {genre && (
            <Badge>{genre}</Badge>
          )}
        </div>

        {/* Festival chips — detection context */}
        {fests.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2.5">
            {fests.slice(0, 2).map((f, i) => {
              const shortName = f.festival_name.replace(/\s*\d{4}$/, '').replace(/\s*presents\s*.*/i, '')
              return (
                <span key={i} className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{ background: `${Y}12`, color: Y, border: `1px solid ${Y}25` }}>
                  {shortName.length > 20 ? shortName.slice(0, 20) + '…' : shortName}
                </span>
              )
            })}
            {fests.length > 2 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: BORDER, color: W30 }}>
                +{fests.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Social stats */}
        <div className="flex items-center gap-4 mb-2.5">
          {[
            { label: 'Spotify', value: fmt(artist.spotify_followers) },
            { label: 'IG', value: fmt(artist.instagram_followers) },
            { label: 'TikTok', value: fmt(artist.tiktok_followers) },
          ].map(s => (
            <div key={s.label}>
              <div className="text-[11px] font-bold text-white leading-none">{s.value}</div>
              <div className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: W30 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: BORDER }}>
          <div className="relative flex-1">
            <button
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-[11px] font-semibold py-1.5 rounded-lg opacity-35 cursor-not-allowed"
              style={{ background: BORDER, color: W50 }}
            >
              Add to Monday
            </button>
            {showTooltip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 rounded-lg text-[10px] whitespace-nowrap z-10"
                style={{ background: '#333', color: W80 }}>
                Coming soon — v2.1
              </div>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setDismissing(true)
              onDismiss(artist.chartmetric_id)
            }}
            disabled={dismissing}
            className="text-[11px] font-medium py-1.5 px-3 rounded-lg transition-colors hover:bg-white/5"
            style={{ color: W30 }}
          >
            {dismissing ? '…' : 'Not Now'}
          </button>
        </div>

        {/* Detected timestamp */}
        <div className="text-right mt-1.5">
          <span className="text-[9px]" style={{ color: W30 }}>Detected {timeAgo(artist.created_at)}</span>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────
export default function DiscoveryPage() {
  const router = useRouter()
  const [artists, setArtists] = useState<DiscoveryArtist[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('week')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [sortBy, setSortBy] = useState<'festivals' | 'score' | 'recent'>('festivals')

  const fetchArtists = () => {
    setLoading(true)
    const params = new URLSearchParams({ period })
    if (period === 'all') params.set('all', 'true')

    fetch(`/api/discovery?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        setArtists(data.artists || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { fetchArtists() }, [period])

  const handleDismiss = async (cmId: number) => {
    await fetch('/api/discovery', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chartmetric_id: cmId, action: 'dismiss' }),
    })
    setArtists(prev => prev.filter(a => a.chartmetric_id !== cmId))
  }

  // Filter and sort
  let filtered = artists
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(a => a.name.toLowerCase().includes(q))
  }
  if (stageFilter) {
    filtered = filtered.filter(a => a.career_stage?.toLowerCase() === stageFilter.toLowerCase())
  }
  if (sortBy === 'score') {
    filtered = [...filtered].sort((a, b) => (b.cm_score || 0) - (a.cm_score || 0))
  } else if (sortBy === 'recent') {
    filtered = [...filtered].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }

  const stages = [...new Set(artists.map(a => a.career_stage).filter(Boolean))]

  return (
    <div className="min-h-screen" style={{ background: BG, fontFamily: 'system-ui, sans-serif' }}>

      {/* NAV */}
      <nav className="flex items-center gap-4 px-5 py-3 border-b sticky top-0 z-50"
        style={{ background: BG, borderColor: BORDER }}>
        <img src="/pty-logo.svg" alt="P&TY" className="h-7 w-auto shrink-0" />
        <div className="h-4 w-px shrink-0" style={{ backgroundColor: BORDER }} />
        <a href="/" className="text-sm transition-colors hover:text-white" style={{ color: W50 }}>Roster</a>
        <a href="/discovery" className="text-sm font-medium" style={{ color: Y }}>Discovery</a>
        <a href="/brand-search" className="text-sm transition-colors hover:text-white" style={{ color: W50 }}>Brand Search</a>
      </nav>

      <div className="px-5 py-5 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="flex items-center gap-3 mb-0.5">
              <h1 className="text-xl font-bold text-white">Discovery</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${Y}22`, color: Y }}>
                {filtered.length} artists
              </span>
            </div>
            <p className="text-xs" style={{ color: W50 }}>
              Artists surfaced from festival lineups. Review and add to your pipeline.
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2.5 mb-5">
          {/* Period toggle */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: BORDER }}>
            {(['week', 'month', 'all'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                style={{
                  background: period === p ? Y : 'transparent',
                  color: period === p ? BG : W30,
                }}>
                {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All'}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search artists..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none min-w-[180px]"
            style={{ background: SURFACE2, borderColor: BORDER, color: '#fff' }}
          />

          {/* Stage filter */}
          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: SURFACE2, borderColor: BORDER, color: W80 }}>
            <option value="">All Stages</option>
            {stages.map(s => <option key={s} value={s!}>{s}</option>)}
          </select>

          {/* Sort */}
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: SURFACE2, borderColor: BORDER, color: W80 }}>
            <option value="festivals">Most Festivals</option>
            <option value="score">Highest CM Score</option>
            <option value="recent">Most Recent</option>
          </select>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20"><Spinner /></div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-20" style={{ color: W30 }}>
            <div className="text-4xl mb-3 opacity-30">📡</div>
            <div className="text-sm font-medium mb-1" style={{ color: W50 }}>
              {search || stageFilter ? 'No artists match your filters' : 'No new discoveries this period'}
            </div>
            <div className="text-xs">
              {period === 'week' ? 'Try "This Month" or "All" to see more.' : 'Run the festival monitor to discover new artists.'}
            </div>
          </div>
        )}

        {/* Card grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((artist, i) => (
              <ArtistCard
                key={artist.chartmetric_id}
                artist={artist}
                index={i}
                onDismiss={handleDismiss}
                onNavigate={(id) => router.push(`/artists/${id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
