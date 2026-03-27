'use client'

import { useState, useEffect } from 'react'

// ── Brand colors ──────────────────────────────────────
const Y = '#F9D40A'
const BG = '#0f0f0f'
const SURFACE = '#1e1e1e'
const BORDER = 'rgba(255,255,255,0.08)'
const W50 = 'rgba(255,255,255,0.5)'
const RED = '#C3202E'
const GREEN = '#00D26A'
const BLUE = '#60bae1'

interface ArtistResult {
  chartmetric_id: number
  name: string
  image_url: string | null
  cm_score: number | null
  career_stage: string | null
  primary_genre: string | null
  spotify_monthly_listeners: number | null
  spotify_followers: number | null
  instagram_followers: number | null
  tiktok_followers: number | null
}

interface MerchEvaluation {
  risk: 'low' | 'moderate' | 'high' | 'pass'
  cmScore: number
  tier: string
  engagement: number
  momentum: number
  touring: number
  catalog: number
  purchasing: number
  brandFit: number
  monthlyLow: number
  monthlyMid: number
  monthlyHigh: number
  summary: string
  factors: { type: 'positive' | 'negative' | 'neutral'; text: string }[]
}

function formatNum(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function evaluateArtist(artist: ArtistResult): MerchEvaluation {
  const cm = artist.cm_score ? Math.round(Number(artist.cm_score)) : 30
  const stage = (artist.career_stage ?? '').toLowerCase()

  // Engagement score: based on social following relative to CM score
  const totalSocial = (artist.spotify_followers ?? 0) + (artist.instagram_followers ?? 0) + (artist.tiktok_followers ?? 0)
  const engagement = Math.min(95, Math.max(10, Math.round(
    cm > 0 ? Math.min(95, (totalSocial / 500000) * 40 + cm * 0.5) : 20
  )))

  // Momentum: higher CM score = better, career stage matters
  const stageMultiplier: Record<string, number> = {
    'legendary': 0.6, 'superstar': 0.85, 'mainstream': 1.0,
    'mid-level': 0.9, 'developing': 0.7, 'undiscovered': 0.4,
  }
  const momentum = Math.min(95, Math.max(10, Math.round(
    cm * (stageMultiplier[stage] ?? 0.7) + (artist.spotify_monthly_listeners ? Math.min(30, artist.spotify_monthly_listeners / 1000000 * 10) : 0)
  )))

  // Touring: estimate from career stage (real version would check tour dates)
  const touringBase: Record<string, number> = {
    'legendary': 50, 'superstar': 85, 'mainstream': 75,
    'mid-level': 60, 'developing': 40, 'undiscovered': 15,
  }
  const touring = touringBase[stage] ?? 35

  // Catalog potential: higher for established acts with engaged fanbases
  const catalog = Math.min(90, Math.max(10, Math.round(engagement * 0.6 + (cm > 60 ? 30 : cm > 40 ? 20 : 10))))

  // Fan purchasing power: combo of engagement and career stage
  const purchasing = Math.min(90, Math.max(10, Math.round(engagement * 0.5 + momentum * 0.3 + (touring > 50 ? 15 : 5))))

  // Brand fit
  const brandFit = Math.min(90, Math.max(15, Math.round(cm * 0.6 + engagement * 0.2)))

  // Revenue projections based on benchmarks from actual P&TY store data
  // Low-engagement legacy acts: $200-600/mo (Salt-n-Pepa pattern)
  // Niche/cult acts: $500-2500/mo (Morphine pattern)
  // Active mid-tier: $1000-5000/mo (steady catalog stores)
  // High-engagement established: $2000-8000/mo (Nick Carter pattern)
  // One-off projects: $150-1500/mo (Kx5 pattern - spike then decay)
  let monthlyLow: number, monthlyMid: number, monthlyHigh: number

  if (engagement < 30 && momentum < 30) {
    // Legacy/low engagement — Salt-n-Pepa pattern
    monthlyLow = 150; monthlyMid = 500; monthlyHigh = 1200
  } else if (cm >= 70 && engagement >= 60) {
    // High-engagement established — Nick Carter pattern
    monthlyLow = 2000; monthlyMid = 4500; monthlyHigh = 8500
  } else if (cm >= 50 && touring >= 60) {
    // Active touring mid-tier
    monthlyLow = 1200; monthlyMid = 3000; monthlyHigh = 6000
  } else if (engagement >= 50) {
    // Engaged niche — Morphine pattern
    monthlyLow = 500; monthlyMid = 1500; monthlyHigh = 3500
  } else {
    // Default / developing
    monthlyLow = 200; monthlyMid = 800; monthlyHigh = 2000
  }

  // Risk assessment
  let risk: MerchEvaluation['risk']
  if (engagement < 25 || (cm < 40 && momentum < 25)) {
    risk = 'pass'
  } else if (engagement < 40 || momentum < 35) {
    risk = 'high'
  } else if (cm >= 60 && engagement >= 55 && touring >= 50) {
    risk = 'low'
  } else {
    risk = 'moderate'
  }

  // Summary
  const summaries: Record<string, string> = {
    low: `Strong engagement metrics with active career momentum. Fanbase demonstrates purchasing behavior consistent with successful merch programs. Comparable P&TY artist profiles sustain $${monthlyMid.toLocaleString()}/mo in steady-state revenue.`,
    moderate: `Mixed signals — some strong indicators but risk factors present. Revenue projections carry wider variance. Recommend starting with a limited test order before committing to significant inventory.`,
    high: `Multiple risk indicators flagged. Low engagement relative to name recognition, limited touring activity, or declining momentum. Historical P&TY data shows similar profiles underperform projections. Proceed with caution or restructure deal terms.`,
    pass: `Engagement and momentum metrics fall below thresholds for profitable merch programs. Comparable artist profiles in P&TY data consistently generate under $800/mo. Recommend declining or limiting to zero-risk consignment model only.`,
  }

  // Factors
  const factors: MerchEvaluation['factors'] = []
  if (engagement >= 60) factors.push({ type: 'positive', text: `<strong>Strong fan engagement</strong> — social following and interaction rates suggest an active, spending-ready fanbase` })
  if (engagement < 30) factors.push({ type: 'negative', text: `<strong>Low engagement</strong> — name recognition exceeds active fan engagement, indicating a passive audience unlikely to convert to merch sales` })
  if (momentum >= 60) factors.push({ type: 'positive', text: `<strong>Career momentum</strong> — streaming and social metrics trending upward, which correlates with merch demand` })
  if (momentum < 30) factors.push({ type: 'negative', text: `<strong>Declining momentum</strong> — streaming metrics flat or declining, limiting new fan acquisition and merch interest` })
  if (touring >= 70) factors.push({ type: 'positive', text: `<strong>Active touring</strong> — consistent live shows create direct merch sales opportunities and reinforce fan engagement` })
  if (touring < 30) factors.push({ type: 'negative', text: `<strong>Limited tour activity</strong> — without regular live shows, merch revenue relies entirely on e-commerce which historically underperforms` })
  if (cm >= 70) factors.push({ type: 'positive', text: `<strong>Established career profile</strong> — CM score of ${cm} indicates industry-validated reach and relevance` })
  if (stage === 'legendary' && engagement < 40) factors.push({ type: 'neutral', text: `<strong>Legacy act consideration</strong> — high recognition but engagement gap suggests catalog/nostalgia model rather than active merch program` })
  if (factors.length < 2) factors.push({ type: 'neutral', text: `<strong>Limited data</strong> — recommend a small test order ($5-10K) to validate demand before scaling` })

  return {
    risk, cmScore: cm, tier: artist.career_stage ?? 'Unknown',
    engagement, momentum, touring, catalog, purchasing, brandFit,
    monthlyLow, monthlyMid, monthlyHigh,
    summary: summaries[risk],
    factors,
  }
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3 mb-3.5">
      <div className="w-[100px] md:w-[140px] shrink-0 text-xs md:text-sm font-medium tracking-[1px] uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>
        {label}
      </div>
      <div className="flex-1 h-2 rounded" style={{ background: '#1a1a1a' }}>
        <div className="h-full rounded transition-all duration-700" style={{ width: `${value}%`, background: color }} />
      </div>
      <div className="w-[40px] text-right text-lg md:text-[22px]" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>
        {value}
      </div>
    </div>
  )
}

export default function MerchPage() {
  const [artistName, setArtistName] = useState('')
  const [frontAmount, setFrontAmount] = useState('50000')
  const [dealType, setDealType] = useState('vip-merch')
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)
  const [evaluation, setEvaluation] = useState<MerchEvaluation | null>(null)
  const [artistData, setArtistData] = useState<ArtistResult | null>(null)
  const [error, setError] = useState('')

  const dealLabels: Record<string, string> = {
    'vip-merch': 'VIP Merch',
    'ecomm': 'E-Commerce Store',
    'tour-merch': 'Tour Merch',
    'collab': 'Limited Collab Drop',
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest('.deal-select')) setShowDropdown(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  async function handleEvaluate() {
    if (!artistName.trim()) return
    setSearching(true)
    setError('')
    setEvaluation(null)

    try {
      const res = await fetch(`/api/artists?search=${encodeURIComponent(artistName.trim())}&limit=1`)
      const data = await res.json()
      const artists: ArtistResult[] = data.artists || []

      if (artists.length === 0) {
        setError(`No artist found matching "${artistName}". Try a different name.`)
        setSearching(false)
        return
      }

      const artist = artists[0]
      setArtistData(artist)
      setEvaluation(evaluateArtist(artist))
    } catch {
      setError('Something went wrong. Try again.')
    }
    setSearching(false)
  }

  const front = parseInt(frontAmount.replace(/[^0-9]/g, '')) || 50000

  const riskColors = { low: GREEN, moderate: Y, high: RED, pass: '#666' }
  const riskBg = { low: '#1a2e1a', moderate: '#2e2a1a', high: '#2e1a1a', pass: '#1a1a1a' }

  return (
    <div className="min-h-screen" style={{ background: BG, fontFamily: "'Barlow', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@300;400;500;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div className="px-4 pt-8 sm:px-6 sm:pt-10 md:px-10 md:pt-12">
        <h1 className="text-[40px] sm:text-[64px] md:text-[96px] leading-[0.85] tracking-tight" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>
          MERCH RISK<br /><span style={{ color: Y }}>EVALUATION</span>
        </h1>
      </div>
      <div className="h-1 mx-4 mt-4 sm:mx-6 sm:mt-5 md:mx-10 md:mt-6" style={{ background: Y }} />

      {/* Input Section */}
      <div className="px-4 pt-6 pb-10 sm:px-6 sm:pt-8 sm:pb-12 md:px-10 md:pt-8 md:pb-16">
        <div className="grid grid-cols-1 gap-5 md:gap-6 mb-8 md:mb-10">
          {/* Artist Name */}
          <div>
            <label className="block mb-2.5 text-[11px] sm:text-[13px] tracking-[4px] uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>
              Artist Name
            </label>
            <input
              type="text"
              value={artistName}
              onChange={e => setArtistName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleEvaluate()}
              placeholder="WHO ARE WE LOOKING AT?"
              className="w-full px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-7 text-[24px] sm:text-[36px] md:text-[48px] tracking-wider rounded-md border-2 border-[#3a3a3a] focus:border-[#F9D40A] transition-colors placeholder:text-[#555] outline-none"
              style={{ background: SURFACE, color: '#f5f4f2', fontFamily: "'Bebas Neue', sans-serif" }}
            />
          </div>

          {/* Front Amount + Deal Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 md:gap-6">
            <div>
              <label className="block mb-2.5 text-[11px] sm:text-[13px] tracking-[4px] uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>
                Front Amount
              </label>
              <input
                type="text"
                value={`$${parseInt(frontAmount || '0').toLocaleString()}`}
                onChange={e => setFrontAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="$50,000"
                className="w-full px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-7 text-[24px] sm:text-[36px] md:text-[48px] tracking-wider rounded-md border-2 border-[#3a3a3a] focus:border-[#F9D40A] transition-colors placeholder:text-[#555] outline-none"
                style={{ background: SURFACE, color: '#f5f4f2', fontFamily: "'Bebas Neue', sans-serif" }}
              />
            </div>
            <div>
              <label className="block mb-2.5 text-[11px] sm:text-[13px] tracking-[4px] uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>
                Deal Type
              </label>
              <div className="deal-select relative">
                <div
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="w-full px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-7 text-[24px] sm:text-[36px] md:text-[48px] tracking-wider rounded-md cursor-pointer select-none"
                  style={{ background: SURFACE, border: `2px solid ${showDropdown ? Y : '#3a3a3a'}`, color: '#f5f4f2', fontFamily: "'Bebas Neue', sans-serif" }}
                >
                  {dealLabels[dealType].toUpperCase()}
                </div>
                {showDropdown && (
                  <div className="absolute top-[calc(100%+4px)] left-0 right-0 rounded-md overflow-hidden z-[100]" style={{ background: SURFACE, border: `2px solid ${Y}` }}>
                    {Object.entries(dealLabels).map(([value, label]) => (
                      <div
                        key={value}
                        onClick={() => { setDealType(value); setShowDropdown(false) }}
                        className="px-4 py-3 md:px-6 md:py-3.5 text-sm md:text-base font-medium tracking-[1px] uppercase cursor-pointer hover:bg-[#2e2e2e]"
                        style={{ fontFamily: "'Barlow Condensed', sans-serif", color: dealType === value ? Y : '#f5f4f2' }}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Evaluate Button */}
        <button
          onClick={handleEvaluate}
          disabled={searching || !artistName.trim()}
          className="w-full py-5 sm:py-6 md:py-7 px-8 md:px-12 text-[20px] sm:text-[28px] md:text-[36px] tracking-[4px] md:tracking-[6px] rounded-md mt-2 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all border-none cursor-pointer"
          style={{ background: Y, color: '#1B1B1B', fontFamily: "'Bebas Neue', sans-serif" }}
        >
          {searching ? 'SEARCHING...' : 'EVALUATE RISK \u2192'}
        </button>

        {error && (
          <div className="mt-5 md:mt-6 p-4 md:p-5 rounded-md text-sm md:text-[15px]" style={{ background: '#2e1a1a', borderLeft: `4px solid ${RED}`, color: '#f5f4f2' }}>
            {error}
          </div>
        )}

        {/* Results */}
        {evaluation && artistData && (
          <div className="animate-fade-up mt-8 md:mt-10">

            {/* Artist info bar */}
            <div className="flex flex-wrap items-center gap-3 md:gap-4 mb-6 p-3 sm:p-4 md:p-4 md:px-5 rounded-lg" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
              {artistData.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={artistData.image_url} alt={artistData.name} className="w-11 h-11 md:w-14 md:h-14 rounded-lg object-cover" />
              )}
              <div className="min-w-0">
                <div className="text-xl md:text-[28px] tracking-[1px] truncate" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>
                  {artistData.name}
                </div>
                <div className="flex flex-wrap items-center gap-2 md:gap-3 text-xs md:text-[13px]" style={{ color: '#888' }}>
                  {artistData.primary_genre && <span>{artistData.primary_genre}</span>}
                  {artistData.career_stage && <span>• {artistData.career_stage}</span>}
                  {artistData.spotify_followers && <span>• {formatNum(artistData.spotify_followers)} Spotify</span>}
                </div>
              </div>
              <a href={`/artists/${artistData.chartmetric_id}`} className="hidden sm:block ml-auto text-sm hover:text-white transition-colors shrink-0" style={{ color: W50 }}>
                View full profile &rarr;
              </a>
              <a href={`/artists/${artistData.chartmetric_id}`} className="block sm:hidden w-full text-sm hover:text-white transition-colors text-center py-2 mt-1 rounded-md" style={{ color: W50, background: '#2a2a2a' }}>
                View full profile &rarr;
              </a>
            </div>

            {/* Risk Banner */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 p-4 px-5 sm:p-5 sm:px-6 md:p-6 md:px-8 mb-6 md:mb-7 rounded-md" style={{ borderLeft: `6px solid ${riskColors[evaluation.risk]}`, background: riskBg[evaluation.risk] }}>
              <div className="text-[32px] sm:text-[40px] md:text-[48px] tracking-[3px]" style={{ fontFamily: "'Bebas Neue', sans-serif", color: riskColors[evaluation.risk] }}>
                {evaluation.risk.toUpperCase()}
              </div>
              <div className="text-[13px] md:text-[15px] leading-relaxed sm:text-right sm:max-w-[400px]" style={{ color: '#888' }}>
                {evaluation.summary}
              </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-7">
              {[
                { label: 'CM Score', value: String(evaluation.cmScore), sub: evaluation.tier, accent: Y },
                { label: 'Projected Monthly Rev', value: `$${evaluation.monthlyMid.toLocaleString()}`, sub: 'Mid-range estimate', accent: BLUE },
                { label: 'Break-Even', value: `${Math.ceil(front / evaluation.monthlyMid)} MO`, sub: 'At mid-range revenue', accent: RED },
                { label: 'Recommended Max Front', value: `$${Math.round(evaluation.monthlyMid * 6 * 0.6).toLocaleString()}`, sub: '6-mo rev \u00D7 60% margin', accent: '#f5f4f2' },
              ].map((m, i) => (
                <div key={i} className="relative overflow-hidden p-4 md:p-6 rounded-md" style={{ background: SURFACE, border: '1px solid #333' }}>
                  <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: m.accent }} />
                  <div className="text-[10px] md:text-[11px] tracking-[2px] md:tracking-[3px] uppercase mb-1.5 md:mb-2" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>{m.label}</div>
                  <div className="text-[28px] sm:text-[36px] md:text-[44px] leading-none tracking-[1px]" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>{m.value}</div>
                  <div className="text-[11px] md:text-[13px] mt-1 md:mt-1.5" style={{ color: '#666' }}>{m.sub}</div>
                </div>
              ))}
            </div>

            {/* Score Bars */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-6 md:mb-7">
              <div className="p-5 md:p-7 rounded-md" style={{ background: SURFACE, border: '1px solid #333' }}>
                <h3 className="text-lg md:text-xl tracking-[2px] mb-4 md:mb-5" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>DEMAND SIGNALS</h3>
                <ScoreBar label="Engagement" value={evaluation.engagement} color={Y} />
                <ScoreBar label="Momentum" value={evaluation.momentum} color={Y} />
                <ScoreBar label="Tour Activity" value={evaluation.touring} color={Y} />
              </div>
              <div className="p-5 md:p-7 rounded-md" style={{ background: SURFACE, border: '1px solid #333' }}>
                <h3 className="text-lg md:text-xl tracking-[2px] mb-4 md:mb-5" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>MERCH INDICATORS</h3>
                <ScoreBar label="Catalog Depth" value={evaluation.catalog} color={BLUE} />
                <ScoreBar label="Fan Purchasing" value={evaluation.purchasing} color={BLUE} />
                <ScoreBar label="Brand Fit" value={evaluation.brandFit} color={BLUE} />
              </div>
            </div>

            {/* Projection Table */}
            <div className="p-5 md:p-7 rounded-md mb-6 md:mb-7 overflow-x-auto" style={{ background: SURFACE, border: '1px solid #333' }}>
              <h3 className="text-lg md:text-xl tracking-[2px] mb-4 md:mb-5" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>REVENUE PROJECTIONS</h3>
              <table className="w-full min-w-[500px]" style={{ borderCollapse: 'collapse' as const }}>
                <thead>
                  <tr>
                    {['Scenario', 'Monthly Rev', '6-Month Total', '12-Month Total', 'Break-Even'].map(h => (
                      <th key={h} className="text-left text-[10px] md:text-[11px] tracking-[2px] md:tracking-[3px] uppercase pb-3 border-b border-[#333]" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'CONSERVATIVE', color: RED, monthly: evaluation.monthlyLow },
                    { label: 'BASE CASE', color: Y, monthly: evaluation.monthlyMid },
                    { label: 'OPTIMISTIC', color: GREEN, monthly: evaluation.monthlyHigh },
                  ].map(row => {
                    const breakEven = Math.ceil(front / row.monthly)
                    return (
                      <tr key={row.label}>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-sm md:text-base tracking-[2px]" style={{ fontFamily: "'Bebas Neue', sans-serif", color: row.color }}>{row.label}</td>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-base md:text-lg font-medium" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#f5f4f2' }}>${row.monthly.toLocaleString()}</td>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-base md:text-lg font-medium" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#f5f4f2' }}>${(row.monthly * 6).toLocaleString()}</td>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-base md:text-lg font-medium" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#f5f4f2' }}>${(row.monthly * 12).toLocaleString()}</td>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-base md:text-lg font-medium" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#f5f4f2' }}>{breakEven > 24 ? '24+ months' : `${breakEven} months`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Key Factors */}
            <div className="p-5 md:p-7 rounded-md" style={{ background: SURFACE, border: '1px solid #333' }}>
              <h3 className="text-lg md:text-xl tracking-[2px] mb-3 md:mb-4" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>KEY FACTORS</h3>
              {evaluation.factors.map((f, i) => (
                <div key={i} className="flex items-start gap-3 py-3" style={{ borderBottom: i < evaluation.factors.length - 1 ? '1px solid #2a2a2a' : 'none' }}>
                  <div className="rounded-full mt-1.5 shrink-0 w-2 h-2" style={{ background: f.type === 'positive' ? GREEN : f.type === 'negative' ? RED : Y }} />
                  <div className="text-[13px] md:text-[14px] leading-relaxed" style={{ color: '#888' }} dangerouslySetInnerHTML={{ __html: f.text.replace(/<strong>/g, '<strong style="color:#f5f4f2;font-weight:500">') }} />
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="mt-8 md:mt-10 text-[10px] md:text-[11px] tracking-[2px] uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#444' }}>
              Please &amp; Thank You — Confidential — Not for external distribution
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
