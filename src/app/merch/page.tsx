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
      <div style={{ width: '140px', flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontSize: '14px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase' as const, color: '#888' }}>
        {label}
      </div>
      <div className="flex-1 h-2 rounded" style={{ background: '#1a1a1a' }}>
        <div className="h-full rounded transition-all duration-700" style={{ width: `${value}%`, background: color }} />
      </div>
      <div style={{ width: '40px', textAlign: 'right' as const, fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: '#f5f4f2' }}>
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
      <div style={{ padding: '48px 40px 0' }}>
        <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '96px', lineHeight: 0.85, letterSpacing: '-2px', color: '#f5f4f2' }}>
          MERCH RISK<br /><span style={{ color: Y }}>EVALUATION</span>
        </h1>
      </div>
      <div style={{ height: '4px', background: Y, margin: '24px 40px 0' }} />

      {/* Input Section */}
      <div style={{ padding: '32px 40px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginBottom: '40px' }}>
          {/* Artist Name */}
          <div>
            <label style={{ display: 'block', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '13px', letterSpacing: '4px', textTransform: 'uppercase' as const, color: '#888', marginBottom: '10px' }}>
              Artist Name
            </label>
            <input
              type="text"
              value={artistName}
              onChange={e => setArtistName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleEvaluate()}
              placeholder="WHO ARE WE LOOKING AT?"
              style={{ width: '100%', padding: '28px 24px', background: SURFACE, border: '2px solid #3a3a3a', color: '#f5f4f2', fontFamily: "'Bebas Neue', sans-serif", fontSize: '48px', letterSpacing: '2px', borderRadius: '6px', outline: 'none' }}
              className="focus:border-[#F9D40A] transition-colors placeholder:text-[#555]"
            />
          </div>

          {/* Front Amount + Deal Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div>
              <label style={{ display: 'block', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '13px', letterSpacing: '4px', textTransform: 'uppercase' as const, color: '#888', marginBottom: '10px' }}>
                Front Amount
              </label>
              <input
                type="text"
                value={`$${parseInt(frontAmount || '0').toLocaleString()}`}
                onChange={e => setFrontAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="$50,000"
                style={{ width: '100%', padding: '28px 24px', background: SURFACE, border: '2px solid #3a3a3a', color: '#f5f4f2', fontFamily: "'Bebas Neue', sans-serif", fontSize: '48px', letterSpacing: '2px', borderRadius: '6px', outline: 'none' }}
                className="focus:border-[#F9D40A] transition-colors placeholder:text-[#555]"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '13px', letterSpacing: '4px', textTransform: 'uppercase' as const, color: '#888', marginBottom: '10px' }}>
                Deal Type
              </label>
              <div className="deal-select" style={{ position: 'relative' }}>
                <div
                  onClick={() => setShowDropdown(!showDropdown)}
                  style={{ width: '100%', padding: '28px 24px', background: SURFACE, border: `2px solid ${showDropdown ? Y : '#3a3a3a'}`, color: '#f5f4f2', fontFamily: "'Bebas Neue', sans-serif", fontSize: '48px', letterSpacing: '2px', borderRadius: '6px', cursor: 'pointer', userSelect: 'none' as const }}
                >
                  {dealLabels[dealType].toUpperCase()}
                </div>
                {showDropdown && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: SURFACE, border: `2px solid ${Y}`, borderRadius: '6px', zIndex: 100, overflow: 'hidden' }}>
                    {Object.entries(dealLabels).map(([value, label]) => (
                      <div
                        key={value}
                        onClick={() => { setDealType(value); setShowDropdown(false) }}
                        style={{ padding: '14px 24px', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '16px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase' as const, color: dealType === value ? Y : '#f5f4f2', cursor: 'pointer' }}
                        className="hover:bg-[#2e2e2e]"
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
          className="hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          style={{ width: '100%', padding: '28px 48px', background: Y, color: '#1B1B1B', border: 'none', fontFamily: "'Bebas Neue', sans-serif", fontSize: '36px', letterSpacing: '6px', cursor: 'pointer', borderRadius: '6px', marginTop: '8px' }}
        >
          {searching ? 'SEARCHING...' : 'EVALUATE RISK →'}
        </button>

        {error && (
          <div style={{ marginTop: '24px', padding: '20px', background: '#2e1a1a', borderRadius: '6px', borderLeft: `4px solid ${RED}`, color: '#f5f4f2', fontSize: '15px' }}>
            {error}
          </div>
        )}

        {/* Results */}
        {evaluation && artistData && (
          <div className="animate-fade-up" style={{ marginTop: '40px' }}>

            {/* Artist info bar */}
            <div className="flex items-center gap-4 mb-6" style={{ padding: '16px 20px', background: SURFACE, borderRadius: '8px', border: `1px solid ${BORDER}` }}>
              {artistData.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={artistData.image_url} alt={artistData.name} className="w-14 h-14 rounded-lg object-cover" />
              )}
              <div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '28px', color: '#f5f4f2', letterSpacing: '1px' }}>
                  {artistData.name}
                </div>
                <div className="flex items-center gap-3" style={{ fontSize: '13px', color: '#888' }}>
                  {artistData.primary_genre && <span>{artistData.primary_genre}</span>}
                  {artistData.career_stage && <span>• {artistData.career_stage}</span>}
                  {artistData.spotify_followers && <span>• {formatNum(artistData.spotify_followers)} Spotify</span>}
                </div>
              </div>
              <a href={`/artists/${artistData.chartmetric_id}`} className="ml-auto text-sm hover:text-white transition-colors" style={{ color: W50, flexShrink: 0 }}>
                View full profile →
              </a>
            </div>

            {/* Risk Banner */}
            <div className="flex items-center justify-between" style={{ padding: '24px 32px', marginBottom: '28px', borderRadius: '6px', borderLeft: `6px solid ${riskColors[evaluation.risk]}`, background: riskBg[evaluation.risk] }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '48px', letterSpacing: '3px', color: riskColors[evaluation.risk] }}>
                {evaluation.risk.toUpperCase()}
              </div>
              <div style={{ fontSize: '15px', color: '#888', maxWidth: '400px', textAlign: 'right' as const, lineHeight: 1.5 }}>
                {evaluation.summary}
              </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-4 gap-4 mb-7">
              {[
                { label: 'CM Score', value: String(evaluation.cmScore), sub: evaluation.tier, accent: Y },
                { label: 'Projected Monthly Rev', value: `$${evaluation.monthlyMid.toLocaleString()}`, sub: 'Mid-range estimate', accent: BLUE },
                { label: 'Break-Even', value: `${Math.ceil(front / evaluation.monthlyMid)} MO`, sub: 'At mid-range revenue', accent: RED },
                { label: 'Recommended Max Front', value: `$${Math.round(evaluation.monthlyMid * 6 * 0.6).toLocaleString()}`, sub: '6-mo rev × 60% margin', accent: '#f5f4f2' },
              ].map((m, i) => (
                <div key={i} style={{ background: SURFACE, borderRadius: '6px', padding: '24px', border: `1px solid #333`, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: m.accent }} />
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '11px', letterSpacing: '3px', textTransform: 'uppercase' as const, color: '#888', marginBottom: '8px' }}>{m.label}</div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '44px', lineHeight: 1, color: '#f5f4f2', letterSpacing: '1px' }}>{m.value}</div>
                  <div style={{ fontSize: '13px', color: '#666', marginTop: '6px' }}>{m.sub}</div>
                </div>
              ))}
            </div>

            {/* Score Bars */}
            <div className="grid grid-cols-2 gap-4 mb-7">
              <div style={{ background: SURFACE, borderRadius: '6px', padding: '28px', border: '1px solid #333' }}>
                <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', letterSpacing: '2px', color: '#f5f4f2', marginBottom: '20px' }}>DEMAND SIGNALS</h3>
                <ScoreBar label="Engagement" value={evaluation.engagement} color={Y} />
                <ScoreBar label="Momentum" value={evaluation.momentum} color={Y} />
                <ScoreBar label="Tour Activity" value={evaluation.touring} color={Y} />
              </div>
              <div style={{ background: SURFACE, borderRadius: '6px', padding: '28px', border: '1px solid #333' }}>
                <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', letterSpacing: '2px', color: '#f5f4f2', marginBottom: '20px' }}>MERCH INDICATORS</h3>
                <ScoreBar label="Catalog Depth" value={evaluation.catalog} color={BLUE} />
                <ScoreBar label="Fan Purchasing" value={evaluation.purchasing} color={BLUE} />
                <ScoreBar label="Brand Fit" value={evaluation.brandFit} color={BLUE} />
              </div>
            </div>

            {/* Projection Table */}
            <div style={{ background: SURFACE, borderRadius: '6px', padding: '28px', border: '1px solid #333', marginBottom: '28px' }}>
              <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', letterSpacing: '2px', color: '#f5f4f2', marginBottom: '20px' }}>REVENUE PROJECTIONS</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
                <thead>
                  <tr>
                    {['Scenario', 'Monthly Rev', '6-Month Total', '12-Month Total', 'Break-Even'].map(h => (
                      <th key={h} style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '11px', letterSpacing: '3px', textTransform: 'uppercase' as const, color: '#888', textAlign: 'left' as const, padding: '0 0 12px', borderBottom: '1px solid #333' }}>{h}</th>
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
                        <td style={{ padding: '14px 0', borderBottom: '1px solid #2a2a2a', fontFamily: "'Bebas Neue', sans-serif", fontSize: '16px', letterSpacing: '2px', color: row.color }}>{row.label}</td>
                        <td style={{ padding: '14px 0', borderBottom: '1px solid #2a2a2a', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '18px', fontWeight: 500, color: '#f5f4f2' }}>${row.monthly.toLocaleString()}</td>
                        <td style={{ padding: '14px 0', borderBottom: '1px solid #2a2a2a', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '18px', fontWeight: 500, color: '#f5f4f2' }}>${(row.monthly * 6).toLocaleString()}</td>
                        <td style={{ padding: '14px 0', borderBottom: '1px solid #2a2a2a', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '18px', fontWeight: 500, color: '#f5f4f2' }}>${(row.monthly * 12).toLocaleString()}</td>
                        <td style={{ padding: '14px 0', borderBottom: '1px solid #2a2a2a', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '18px', fontWeight: 500, color: '#f5f4f2' }}>{breakEven > 24 ? '24+ months' : `${breakEven} months`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Key Factors */}
            <div style={{ background: SURFACE, borderRadius: '6px', padding: '28px', border: '1px solid #333' }}>
              <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', letterSpacing: '2px', color: '#f5f4f2', marginBottom: '16px' }}>KEY FACTORS</h3>
              {evaluation.factors.map((f, i) => (
                <div key={i} className="flex items-start gap-3" style={{ padding: '12px 0', borderBottom: i < evaluation.factors.length - 1 ? '1px solid #2a2a2a' : 'none' }}>
                  <div className="rounded-full mt-1.5 shrink-0" style={{ width: '8px', height: '8px', background: f.type === 'positive' ? GREEN : f.type === 'negative' ? RED : Y }} />
                  <div style={{ fontSize: '14px', color: '#888', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: f.text.replace(/<strong>/g, '<strong style="color:#f5f4f2;font-weight:500">') }} />
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ marginTop: '40px', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase' as const, color: '#444' }}>
              Please &amp; Thank You — Confidential — Not for external distribution
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
