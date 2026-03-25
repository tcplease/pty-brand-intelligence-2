'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { STAGE_ORDER } from '@/types'

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
  deal_stage?: string | null
  sales_leads?: string[]
}

interface UserInfo {
  name: string
  email: string
  role: string
  monday_person_name: string | null
}

// ── Brand colors ──────────────────────────────────────
const Y = '#F9D40A'
const BG = '#0f0f0f'
const SURFACE = '#1e1e1e'
const BORDER = 'rgba(255,255,255,0.08)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'
const GREEN = '#00D26A'
const BLUE = '#60bae1'

const CAREER_COLORS: Record<string, string> = {
  legendary: '#ef4444',
  superstar: '#f97316',
  mainstream: '#F9D40A',
  'mid-level': '#00D26A',
  developing: '#4A9EFF',
  undiscovered: 'rgba(255,255,255,0.3)',
}

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

function ArtistCard({ artist, href }: { artist: Artist; href: string }) {
  const score = artist.cm_score ? Math.round(Number(artist.cm_score)) : null
  const careerColor = CAREER_COLORS[artist.career_stage?.toLowerCase() ?? ''] ?? W50
  const stageColor = artist.deal_stage ? (STAGE_COLORS[artist.deal_stage] ?? W50) : null

  return (
    <a href={href} className="block h-full" style={{ color: '#f5f4f2', opacity: artist.is_dimmed ? 0.4 : 1 }}>
      <div className="flex flex-col h-full" style={{ backgroundColor: SURFACE, borderRadius: '8px', overflow: 'hidden', border: `1px solid ${BORDER}` }}>
        <div className="relative overflow-hidden h-[160px] sm:h-[160px]" style={{ backgroundColor: '#2a2a2a' }}>
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

        <div className="flex-1 flex flex-col" style={{ padding: '10px 12px 12px' }}>
          <div className="truncate" style={{ fontSize: '13px', fontWeight: 600, color: '#f5f4f2', marginBottom: '2px' }}>
            {artist.name}
          </div>
          <div className="flex flex-col" style={{ gap: '1px', marginBottom: '8px' }}>
            {artist.primary_genre && (
              <div style={{ lineHeight: 1 }}>
                <span style={{
                  fontSize: '8px',
                  fontWeight: 600,
                  padding: '2px 7px',
                  borderRadius: '4px',
                  background: 'rgba(255,255,255,0.07)',
                  color: W50,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  display: 'inline-block',
                }}>
                  {artist.primary_genre}
                </span>
              </div>
            )}
            {artist.career_stage && (
              <div style={{ lineHeight: 1 }}>
                <span style={{
                  fontSize: '8px',
                  fontWeight: 600,
                  padding: '2px 7px',
                  borderRadius: '4px',
                  background: `${careerColor}15`,
                  color: careerColor,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  display: 'inline-block',
                }}>
                  {artist.career_stage}
                </span>
              </div>
            )}
            {stageColor && artist.deal_stage && (
              <div style={{ lineHeight: 1 }}>
                <span style={{
                  fontSize: '8px',
                  fontWeight: 600,
                  padding: '2px 7px',
                  borderRadius: '4px',
                  background: `${stageColor}15`,
                  color: stageColor,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  display: 'inline-block',
                }}>
                  {STAGE_SHORT_LABELS[artist.deal_stage] ?? artist.deal_stage}
                </span>
              </div>
            )}
          </div>
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
  const [stageFilter, setStageFilter] = useState('All Deal Stages')
  const [stageOptions, setStageOptions] = useState<string[]>([])
  const [sort, setSort] = useState<'score' | 'az' | 'reach'>('score')
  const [showFilterDrawer, setShowFilterDrawer] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [myDeals, setMyDeals] = useState(false)
  const [user, setUser] = useState<UserInfo | null>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout>()
  const mobileSearchRef = useRef<HTMLInputElement>(null)

  // Fetch current user info
  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => {
      if (d.email) setUser(d)
    }).catch(() => {})
  }, [])

  const activeFilterCount = [
    genre !== 'All Genres',
    stageFilter !== 'All Deal Stages',
    sort !== 'score',
  ].filter(Boolean).length

  const hasActiveFilters = genre !== 'All Genres' || stageFilter !== 'All Deal Stages'

  const fetchArtists = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('limit', '500')
      const res = await fetch(`/api/artists?${params}`)
      const data = await res.json()
      const list: Artist[] = data.artists || []
      setAllArtists(list)
      if (!search) {
        const gs = new Set(list.map((a: Artist) => a.primary_genre).filter(Boolean) as string[])
        setGenres(Array.from(gs).sort())
        const stageSet = new Set(list.map((a: Artist) => a.deal_stage).filter(Boolean) as string[])
        setStageOptions(STAGE_ORDER.filter(s => stageSet.has(s)))
      }
    } catch (err) { console.error(err) }
    setLoading(false)
  }, [search])

  useEffect(() => { fetchArtists() }, [fetchArtists])

  useEffect(() => {
    let result = [...allArtists]
    if (myDeals && user?.monday_person_name) {
      result = result.filter(a => a.sales_leads?.some(lead => lead === user.monday_person_name))
    }
    if (genre !== 'All Genres') result = result.filter(a => a.primary_genre === genre)
    if (stageFilter !== 'All Deal Stages') result = result.filter(a => a.deal_stage === stageFilter)
    if (sort === 'score') result.sort((a, b) => (b.cm_score ?? 0) - (a.cm_score ?? 0))
    if (sort === 'az') result.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'reach') result.sort((a, b) => (b.spotify_followers ?? 0) - (a.spotify_followers ?? 0))
    setArtists(result)
  }, [allArtists, genre, stageFilter, sort, myDeals, user])

  const handleSearch = (value: string) => {
    setSearchInput(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => setSearch(value), 300)
  }

  return (
    <div className="min-h-screen" style={{ background: BG, fontFamily: 'system-ui, sans-serif' }}>

      {/* NAV */}
      <nav className="flex items-center gap-4 px-4 md:px-6 py-3 border-b sticky top-0 z-50"
        style={{ background: BG, borderColor: BORDER }}>
        <img src="/pty-logo.svg" alt="P&TY" className="h-9 w-auto shrink-0" />
        <div className="h-4 w-px shrink-0" style={{ backgroundColor: BORDER }} />
        <Link href="/" className="text-sm py-3 px-3 block font-medium" style={{ color: Y, touchAction: 'manipulation', WebkitTapHighlightColor: 'rgba(249,212,10,0.15)' }}>Pipeline</Link>
        <Link href="/discovery" className="text-sm py-3 px-3 block transition-colors hover:text-white" style={{ color: W50, touchAction: 'manipulation', WebkitTapHighlightColor: 'rgba(255,255,255,0.1)' }}>Radar</Link>
        <Link href="/brand-search" className="text-sm py-3 px-3 block transition-colors hover:text-white" style={{ color: W50, touchAction: 'manipulation', WebkitTapHighlightColor: 'rgba(255,255,255,0.1)' }}>Match</Link>

        {/* My Deals toggle */}
        {user?.monday_person_name && (
          <button
            onClick={() => setMyDeals(prev => !prev)}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors"
            style={{
              borderColor: myDeals ? Y : BORDER,
              background: myDeals ? Y : 'transparent',
              color: myDeals ? BG : W50,
              fontWeight: myDeals ? 600 : 400,
              touchAction: 'manipulation',
            }}
          >
            My Deals
          </button>
        )}

        {/* Desktop filters */}
        <div className="hidden md:flex items-center gap-3 ml-auto">
          <div className="relative">
            <input
              placeholder="Search artists..."
              value={searchInput}
              onChange={e => handleSearch(e.target.value)}
              className="px-3 py-1.5 rounded-lg border text-sm outline-none w-48"
              inputMode="search" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              style={{ background: '#1C1C1C', borderColor: BORDER, color: '#fff' }}
            />
          </div>
          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-sm outline-none"
            style={{ background: '#1C1C1C', borderColor: stageFilter !== 'All Deal Stages' ? Y : BORDER, color: 'rgba(255,255,255,0.8)' }}>
            <option>All Deal Stages</option>
            {stageOptions.map(s => <option key={s} value={s}>{STAGE_SHORT_LABELS[s] ?? s}</option>)}
          </select>
          <select value={genre} onChange={e => setGenre(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-sm outline-none"
            style={{ background: '#1C1C1C', borderColor: genre !== 'All Genres' ? Y : BORDER, color: 'rgba(255,255,255,0.8)' }}>
            <option>All Genres</option>
            {genres.map(g => <option key={g}>{g}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as any)}
            className="px-3 py-1.5 rounded-lg border text-sm outline-none"
            style={{ background: '#1C1C1C', borderColor: BORDER, color: 'rgba(255,255,255,0.8)' }}>
            <option value="score">CM Score</option>
            <option value="az">A–Z</option>
            <option value="reach">Reach</option>
          </select>
          {user && (
            <div className="flex items-center gap-2 ml-2 pl-2 border-l" style={{ borderColor: BORDER }}>
              <span className="text-xs" style={{ color: W50 }}>{user.name}</span>
              <button
                onClick={async () => { await fetch('/api/auth/signout', { method: 'POST' }); window.location.href = '/login' }}
                className="text-xs hover:text-white transition-colors"
                style={{ color: W30 }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Mobile search + filter bar — below nav */}
      <div className="md:hidden flex items-center justify-end px-4 py-2 border-b" style={{ borderColor: BORDER, background: BG }}>
        <button onClick={() => {
          setShowMobileSearch(prev => !prev)
          setTimeout(() => mobileSearchRef.current?.focus(), 100)
        }} className="p-3" style={{ color: search ? Y : '#888' }}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
        <button onClick={() => setShowFilterDrawer(true)} className="p-3 relative" style={{ color: activeFilterCount > 0 ? Y : '#888' }}>
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
      </div>

      {/* Mobile search bar */}
      {showMobileSearch && (
        <div className="md:hidden px-4 py-2 border-b" style={{ borderColor: BORDER, background: BG }}>
          <input
            ref={mobileSearchRef}
            placeholder="Search artists..."
            value={searchInput}
            onChange={e => handleSearch(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-base outline-none"
            style={{ background: '#1C1C1C', borderColor: BORDER, color: '#fff' }}
            inputMode="search" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          />
        </div>
      )}

      {/* Active filter chips — mobile only */}
      {hasActiveFilters && (
        <div className="flex md:hidden items-center gap-2 px-4 py-2 border-b flex-wrap"
          style={{ borderColor: BORDER }}>
          {stageFilter !== 'All Deal Stages' && (
            <button onClick={() => setStageFilter('All Deal Stages')}
              className="flex items-center gap-1 px-3 py-2 rounded-full text-xs font-bold"
              style={{ backgroundColor: Y, color: '#0a0a0a' }}>
              {STAGE_SHORT_LABELS[stageFilter] ?? stageFilter} <span className="opacity-60">✕</span>
            </button>
          )}
          {genre !== 'All Genres' && (
            <button onClick={() => setGenre('All Genres')}
              className="flex items-center gap-1 px-3 py-2 rounded-full text-xs font-bold border"
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
          <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]" style={{ gap: '4px' }}>
            {artists.map(artist => (
              <ArtistCard key={artist.chartmetric_id} artist={artist}
                href={`/artists/${artist.chartmetric_id}`} />
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
                  <button onClick={() => { setGenre('All Genres'); setStageFilter('All Deal Stages') }}
                    className="text-xs" style={{ color: '#888' }}>
                    Clear all
                  </button>
                )}
              </div>

              {/* Deal Stage */}
              <div className="mb-5">
                <label className="text-xs uppercase tracking-wider mb-2 block" style={{ color: '#888' }}>Deal Stage</label>
                <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl text-sm border focus:outline-none"
                  style={{ backgroundColor: SURFACE, borderColor: stageFilter !== 'All Deal Stages' ? Y : '#2a2a2a', color: '#fff' }}>
                  <option>All Deal Stages</option>
                  {stageOptions.map(s => <option key={s} value={s}>{STAGE_SHORT_LABELS[s] ?? s}</option>)}
                </select>
              </div>

              {/* Genre */}
              <div className="mb-5">
                <label className="text-xs uppercase tracking-wider mb-2 block" style={{ color: '#888' }}>Genre</label>
                <select value={genre} onChange={e => setGenre(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl text-sm border focus:outline-none"
                  style={{ backgroundColor: SURFACE, borderColor: genre !== 'All Genres' ? Y : '#2a2a2a', color: '#fff' }}>
                  <option>All Genres</option>
                  {genres.map(g => <option key={g}>{g}</option>)}
                </select>
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
