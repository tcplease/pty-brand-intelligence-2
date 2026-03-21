'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Brand colors ──────────────────────────────────────
const Y = '#F9D40A'
const BG = '#0f0f0f'
const SURFACE = '#1e1e1e'
const SURFACE2 = '#1C1C1C'
const BORDER = 'rgba(255,255,255,0.08)'
const W80 = 'rgba(255,255,255,0.8)'
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
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
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
    const base = f.festival_name.replace(/\s*\(Weekend (One|Two)\)\s*/i, '').trim()
    if (seen.has(base)) return false
    seen.add(base)
    return true
  })
}

function primaryGenre(genre: string | null): string {
  if (!genre) return ''
  return genre.split(',')[0].trim()
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
  onActivity,
}: {
  artist: DiscoveryArtist
  index: number
  onDismiss: (id: number) => void
  onNavigate: (id: number) => void
  onActivity: (id: number) => void
}) {
  const [dismissing, setDismissing] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const careerColor = CAREER_COLORS[artist.career_stage?.toLowerCase() ?? ''] ?? W50
  const fests = uniqueFestivals(artist.festivals)
  const genre = primaryGenre(artist.primary_genre)

  return (
    <div
      style={{
        background: SURFACE,
        borderRadius: '8px',
        overflow: 'hidden',
        border: `1px solid ${BORDER}`,
        cursor: 'pointer',
        animation: `fadeIn 0.3s ease-out ${index * 0.04}s both`,
      }}
      className="transition-all duration-200 hover:border-white/15 group"
      onClick={() => onNavigate(artist.chartmetric_id)}
    >
      {/* Image — 4:3 with gradient overlay */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '4/3', backgroundColor: '#2a2a2a' }}>
        {artist.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist.image_url}
            alt={artist.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl font-bold"
            style={{ color: W30 }}>
            {artist.name[0]}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-20" style={{ background: `linear-gradient(to top, ${SURFACE} 0%, transparent 100%)` }} />

        {artist.cm_score != null && (
          <div className="absolute font-bold" style={{ top: '8px', right: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(27,27,27,0.9)', color: Y }}>
            {Math.round(artist.cm_score)}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '10px 12px 12px', marginTop: '-2px' }}>
        <div className="truncate" style={{ fontSize: '13px', fontWeight: 600, color: '#f5f4f2', marginBottom: '5px' }}>
          {artist.name}
        </div>

        <div className="flex items-center" style={{ gap: '4px', marginBottom: '8px' }}>
          {artist.career_stage && (
            <span style={{
              fontSize: '8px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
              background: `${careerColor}15`, color: careerColor,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {artist.career_stage}
            </span>
          )}
          {genre && (
            <span style={{
              fontSize: '8px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
              background: 'rgba(255,255,255,0.07)', color: W50,
              textTransform: 'uppercase', letterSpacing: '0.04em',
              maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', display: 'inline-block',
            }}>
              {genre}
            </span>
          )}
        </div>
        {/* Festival count — links to activity */}
        {artist.festival_count > 0 && (
          <div
            onClick={(e) => { e.stopPropagation(); onActivity(artist.chartmetric_id) }}
            className="text-xs font-medium mb-2 cursor-pointer hover:underline"
            style={{ color: Y }}
          >
            🎪 {artist.festival_count} festival{artist.festival_count !== 1 ? 's' : ''}
          </div>
        )}
        <div className="flex items-center" style={{ gap: '8px', marginBottom: '8px' }}>
          <div className="flex items-center" style={{ gap: '3px' }}>
            <svg style={{ width: '11px', height: '11px', color: '#888', flexShrink: 0 }} viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            <span style={{ fontSize: '11px', color: '#888' }}>{fmt(artist.spotify_followers)}</span>
          </div>
          <div className="flex items-center" style={{ gap: '3px' }}>
            <svg style={{ width: '11px', height: '11px', color: '#888', flexShrink: 0 }} viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6m9.65 1.5a1.25 1.25 0 0 1 1.25 1.25A1.25 1.25 0 0 1 17.25 8 1.25 1.25 0 0 1 16 6.75a1.25 1.25 0 0 1 1.25-1.25M12 7a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>
            </svg>
            <span style={{ fontSize: '11px', color: '#888' }}>{fmt(artist.instagram_followers)}</span>
          </div>
          <div className="flex items-center" style={{ gap: '3px' }}>
            <svg style={{ width: '11px', height: '11px', color: '#888', flexShrink: 0 }} viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z"/>
            </svg>
            <span style={{ fontSize: '11px', color: '#888' }}>{fmt(artist.tiktok_followers)}</span>
          </div>
        </div>

        <div className="flex items-center" style={{ gap: '6px', paddingTop: '8px', borderTop: `1px solid ${BORDER}` }}>
          <div className="relative flex-1">
            <button
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              onClick={(e) => e.stopPropagation()}
              className="w-full"
              style={{ fontSize: '11px', fontWeight: 600, padding: '5px 0', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', color: W30, border: 'none', cursor: 'not-allowed' }}
            >
              Add to Monday
            </button>
            {showTooltip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 rounded-lg whitespace-nowrap z-10"
                style={{ fontSize: '10px', background: '#333', color: W80 }}>
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
            className="transition-colors hover:bg-white/5"
            style={{ fontSize: '11px', fontWeight: 500, padding: '5px 10px', borderRadius: '6px', color: W30, background: 'transparent', border: 'none' }}
          >
            {dismissing ? '…' : 'Not Now'}
          </button>
        </div>

        <div style={{ textAlign: 'right', marginTop: '4px' }}>
          <span style={{ fontSize: '9px', color: W30 }}>Detected {timeAgo(artist.created_at)}</span>
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
  const [minFestivals, setMinFestivals] = useState(0)

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

  let filtered = artists
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(a => a.name.toLowerCase().includes(q))
  }
  if (stageFilter) {
    filtered = filtered.filter(a => a.career_stage?.toLowerCase() === stageFilter.toLowerCase())
  }
  if (minFestivals > 0) {
    filtered = filtered.filter(a => a.festival_count >= minFestivals)
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
      <nav className="flex items-center gap-4 px-4 md:px-6 py-3 border-b sticky top-0 z-50"
        style={{ background: BG, borderColor: BORDER }}>
        <img src="/pty-logo.svg" alt="P&TY" className="h-7 w-auto shrink-0" />
        <div className="h-4 w-px shrink-0" style={{ backgroundColor: BORDER }} />
        <a href="/" className="text-sm transition-colors hover:text-white" style={{ color: W50 }}>Roster</a>
        <a href="/discovery" className="text-sm font-medium" style={{ color: Y }}>Discovery</a>
        <a href="/brand-search" className="text-sm transition-colors hover:text-white" style={{ color: W50 }}>Brand Search</a>
      </nav>

      <div className="px-2 md:px-6 py-5">

        {/* Header */}
        <div className="flex items-start justify-between mb-5 px-2 md:px-0">
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
        <div className="flex flex-wrap items-center gap-2.5 mb-5 px-2 md:px-0">
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

          <input
            type="text"
            placeholder="Search artists..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none min-w-[180px]"
            style={{ background: SURFACE2, borderColor: BORDER, color: '#fff' }}
          />

          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: SURFACE2, borderColor: BORDER, color: W80 }}>
            <option value="">All Career Stages</option>
            {stages.map(s => <option key={s} value={s!}>{s}</option>)}
          </select>

          <select value={minFestivals} onChange={e => setMinFestivals(parseInt(e.target.value))}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: SURFACE2, borderColor: BORDER, color: W80 }}>
            <option value="0">All Festivals</option>
            <option value="2">2+ Festivals</option>
            <option value="3">3+ Festivals</option>
            <option value="4">4+ Festivals</option>
          </select>

          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: SURFACE2, borderColor: BORDER, color: W80 }}>
            <option value="festivals">Most Festivals</option>
            <option value="score">Highest CM Score</option>
            <option value="recent">Most Recent</option>
          </select>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20"><Spinner /></div>
        )}

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

        {!loading && filtered.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px' }}>
            {filtered.map((artist, i) => (
              <ArtistCard
                key={artist.chartmetric_id}
                artist={artist}
                index={i}
                onDismiss={handleDismiss}
                onNavigate={(id) => router.push(`/artists/${id}`)}
                onActivity={(id) => router.push(`/artists/${id}?tab=activity`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
