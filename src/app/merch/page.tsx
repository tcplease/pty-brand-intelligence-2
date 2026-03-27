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

interface VipSellthroughRow {
  label: string
  sellthrough: number
  gross: number
  netToSplit: number
  ptyShare: number
  artistShare: number
  vsFront: number
}

interface VipEvaluation {
  risk: 'low' | 'moderate' | 'high' | 'pass'
  cmScore: number
  tier: string
  totalPackages: number
  breakEvenSellthrough: number | null // null if impossible
  recommendedMaxFront: number
  rows: VipSellthroughRow[]
  summary: string
  factors: { type: 'positive' | 'negative' | 'neutral'; text: string }[]
}

function formatNum(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

interface BenchmarkData {
  artistBenchmark: {
    tm_total_orders: number
    tm_total_revenue: number
    tm_event_count: number
    tm_avg_order_value: number
    axs_total_orders: number
    axs_total_revenue: number
    axs_event_count: number
    axs_avg_order_value: number
    shopify_monthly_revenue: number | null
  } | null
  bandSummary: Record<string, { count: number; avgRevenue: number; avgOrders: number }>
  vipToMerchRatios: { artist: string; vipRevenue: number; monthlyMerch: number; ratio: number }[]
}

// ── VIP Merch Evaluation ──────────────────────────────
function computeVipRow(
  sellthrough: number,
  totalPackages: number,
  avgLiftPrice: number,
  merchCOGS: number,
  numShows: number,
  label: string,
  frontAmount: number,
): VipSellthroughRow {
  const grossAtSellthrough = totalPackages * sellthrough * avgLiftPrice
  const ticketingFees = grossAtSellthrough * 0.10
  const adminFees = grossAtSellthrough * 0.03
  const grossAfterFees = grossAtSellthrough - ticketingFees - adminFees
  const variableCosts = totalPackages * sellthrough * merchCOGS * 1.15
  const fixedCosts = numShows * 1500
  const netToSplit = grossAfterFees - variableCosts - fixedCosts
  const ptyShare = netToSplit * 0.10
  const artistShare = netToSplit - ptyShare
  return {
    label,
    sellthrough,
    gross: Math.round(grossAtSellthrough),
    netToSplit: Math.round(netToSplit),
    ptyShare: Math.round(ptyShare),
    artistShare: Math.round(artistShare),
    vsFront: Math.round(artistShare - frontAmount),
  }
}

function evaluateVipMerch(
  artist: ArtistResult,
  frontAmount: number,
  numShows: number,
  packagesPerShow: number,
  avgLiftPrice: number,
  merchCOGS: number,
  benchmarks: BenchmarkData | null,
): VipEvaluation {
  const cm = artist.cm_score ? Math.round(Number(artist.cm_score)) : 30
  const totalPackages = numShows * packagesPerShow
  const bench = benchmarks?.artistBenchmark
  const totalVipOrders = (bench?.tm_total_orders ?? 0) + (bench?.axs_total_orders ?? 0)
  const totalVipRevenue = (bench?.tm_total_revenue ?? 0) + (bench?.axs_total_revenue ?? 0)
  const hasVipData = totalVipOrders > 0

  // Compute rows at 4 sellthrough rates
  const sellthroughRates = [
    { rate: 0.50, label: 'CONSERVATIVE' },
    { rate: 0.75, label: 'BASE CASE' },
    { rate: 0.90, label: 'STRONG' },
    { rate: 1.00, label: 'FULL' },
  ]
  const rows = sellthroughRates.map(s =>
    computeVipRow(s.rate, totalPackages, avgLiftPrice, merchCOGS, numShows, s.label, frontAmount)
  )

  // Find break-even sellthrough (binary search for artistShare >= frontAmount)
  let breakEvenSellthrough: number | null = null
  // Check if even 100% covers it
  const fullRow = computeVipRow(1.0, totalPackages, avgLiftPrice, merchCOGS, numShows, '', frontAmount)
  if (fullRow.artistShare >= frontAmount) {
    // Binary search between 0% and 100%
    let lo = 0, hi = 1.0
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2
      const testRow = computeVipRow(mid, totalPackages, avgLiftPrice, merchCOGS, numShows, '', frontAmount)
      if (testRow.artistShare >= frontAmount) {
        hi = mid
      } else {
        lo = mid
      }
    }
    breakEvenSellthrough = Math.round(hi * 1000) / 10 // one decimal place percentage
  }

  // Risk assessment
  let risk: VipEvaluation['risk']
  if (breakEvenSellthrough === null || breakEvenSellthrough > 95) {
    risk = 'pass'
  } else if (breakEvenSellthrough > 80) {
    risk = 'high'
  } else if (breakEvenSellthrough > 60) {
    risk = 'moderate'
  } else {
    // break-even at <= 60%, but also check for VIP benchmark data
    risk = hasVipData ? 'low' : 'moderate'
  }

  // Recommended max front = artist share at 75% sellthrough * 0.8
  const baseCaseRow = rows.find(r => r.sellthrough === 0.75)
  const recommendedMaxFront = Math.round((baseCaseRow?.artistShare ?? 0) * 0.8)

  // Summary
  const dataConfidence = hasVipData
    ? 'Based on actual P&TY VIP ticket sales data for this artist.'
    : 'Estimated from inputs only. No direct VIP sales data available for this artist.'

  const beSummary = breakEvenSellthrough !== null
    ? `Break-even at ${breakEvenSellthrough.toFixed(1)}% sellthrough.`
    : 'Break-even is not achievable even at 100% sellthrough.'

  const summaries: Record<string, string> = {
    low: `${dataConfidence} ${beSummary} Strong risk/reward profile at the proposed front amount.`,
    moderate: `${dataConfidence} ${beSummary} Consider reducing the front or validating with a test run.`,
    high: `${dataConfidence} ${beSummary} Front amount of $${frontAmount.toLocaleString()} requires very high sellthrough to recoup. Recommend restructuring.`,
    pass: `${dataConfidence} ${beSummary} Recommend declining or restructuring to a zero-risk model.`,
  }

  // Key factors
  const factors: VipEvaluation['factors'] = []

  if (hasVipData) {
    factors.push({ type: 'positive', text: `<strong>Real P&TY data:</strong> ${totalVipOrders.toLocaleString()} orders, $${Math.round(totalVipRevenue).toLocaleString()} revenue across ${(bench?.tm_event_count ?? 0) + (bench?.axs_event_count ?? 0)} events` })
    const actualAvgOrder = totalVipOrders > 0 ? totalVipRevenue / totalVipOrders : 0
    if (actualAvgOrder > 0) {
      const comparison = actualAvgOrder >= avgLiftPrice
        ? `above the proposed lift price of $${avgLiftPrice} — positive signal`
        : `below the proposed lift price of $${avgLiftPrice} — may indicate pricing risk`
      factors.push({ type: actualAvgOrder >= avgLiftPrice ? 'positive' : 'negative', text: `<strong>Avg order value:</strong> $${Math.round(actualAvgOrder).toLocaleString()} ${comparison}` })
    }
    if (totalVipRevenue > 500000) {
      factors.push({ type: 'positive', text: `<strong>Top-tier VIP performer</strong> — revenue places this artist in the top 10% of P&TY's portfolio` })
    }
  } else {
    factors.push({ type: 'neutral', text: `<strong>No P&TY VIP sales history</strong> — projections are based on inputs only, no historical validation. Recommend a test run or reduced front.` })
  }

  if (breakEvenSellthrough !== null && breakEvenSellthrough > 80) {
    factors.push({ type: 'negative', text: `<strong>High sellthrough required</strong> — need ${breakEvenSellthrough.toFixed(1)}% sellthrough to recoup the front. Most VIP programs achieve 60-80%.` })
  }

  if (recommendedMaxFront > 0 && frontAmount > recommendedMaxFront * 1.25) {
    factors.push({ type: 'negative', text: `<strong>Front exceeds recommended max</strong> — suggested max front is $${recommendedMaxFront.toLocaleString()} based on 75% sellthrough projections.` })
  }

  if (factors.length < 2) {
    factors.push({ type: 'neutral', text: `<strong>Limited data</strong> — recommend a small test run to validate demand before committing full front amount.` })
  }

  return {
    risk,
    cmScore: cm,
    tier: artist.career_stage ?? 'Unknown',
    totalPackages,
    breakEvenSellthrough,
    recommendedMaxFront,
    rows,
    summary: summaries[risk],
    factors,
  }
}

function evaluateArtist(artist: ArtistResult, frontAmount: number, benchmarks: BenchmarkData | null): MerchEvaluation {
  const cm = artist.cm_score ? Math.round(Number(artist.cm_score)) : 30
  const stage = (artist.career_stage ?? '').toLowerCase()
  const bench = benchmarks?.artistBenchmark
  const bands = benchmarks?.bandSummary || {}
  const ratios = benchmarks?.vipToMerchRatios || []

  // ── ENGAGEMENT SCORE ──
  // If we have real VIP data, use it. Otherwise estimate from socials.
  const totalVipRevenue = (bench?.tm_total_revenue ?? 0) + (bench?.axs_total_revenue ?? 0)
  const totalVipOrders = (bench?.tm_total_orders ?? 0) + (bench?.axs_total_orders ?? 0)
  const hasVipData = totalVipOrders > 0

  const totalSocial = (artist.spotify_followers ?? 0) + (artist.instagram_followers ?? 0) + (artist.tiktok_followers ?? 0)

  let engagement: number
  if (hasVipData) {
    // Real data: score based on actual VIP revenue relative to peers
    const revenuePercentile = Math.min(95, Math.round((totalVipRevenue / 2000000) * 80 + 15))
    engagement = revenuePercentile
  } else {
    engagement = Math.min(95, Math.max(10, Math.round(
      cm > 0 ? Math.min(95, (totalSocial / 500000) * 40 + cm * 0.5) : 20
    )))
  }

  // ── MOMENTUM SCORE ──
  const stageMultiplier: Record<string, number> = {
    'legendary': 0.6, 'superstar': 0.85, 'mainstream': 1.0,
    'mid-level': 0.9, 'developing': 0.7, 'undiscovered': 0.4,
  }
  const momentum = Math.min(95, Math.max(10, Math.round(
    cm * (stageMultiplier[stage] ?? 0.7) + (artist.spotify_monthly_listeners ? Math.min(30, artist.spotify_monthly_listeners / 1000000 * 10) : 0)
  )))

  // ── TOURING SCORE ──
  let touring: number
  if (hasVipData) {
    const eventCount = (bench?.tm_event_count ?? 0) + (bench?.axs_event_count ?? 0)
    touring = Math.min(95, Math.max(10, Math.round(eventCount * 2.5 + 20)))
  } else {
    const touringBase: Record<string, number> = {
      'legendary': 50, 'superstar': 85, 'mainstream': 75,
      'mid-level': 60, 'developing': 40, 'undiscovered': 15,
    }
    touring = touringBase[stage] ?? 35
  }

  // ── CATALOG + PURCHASING + BRAND FIT ──
  const catalog = Math.min(90, Math.max(10, Math.round(engagement * 0.6 + (cm > 60 ? 30 : cm > 40 ? 20 : 10))))
  const purchasing = Math.min(90, Math.max(10, Math.round(engagement * 0.5 + momentum * 0.3 + (touring > 50 ? 15 : 5))))
  const brandFit = Math.min(90, Math.max(15, Math.round(cm * 0.6 + engagement * 0.2)))

  // ── REVENUE PROJECTIONS ──
  // Priority: actual Shopify data > VIP-to-Merch ratio > CM score band estimate
  let monthlyLow: number, monthlyMid: number, monthlyHigh: number

  if (bench?.shopify_monthly_revenue) {
    // Best case: we have actual merch revenue data for this artist
    const actual = bench.shopify_monthly_revenue
    monthlyLow = Math.round(actual * 0.6)
    monthlyMid = Math.round(actual)
    monthlyHigh = Math.round(actual * 1.5)
  } else if (hasVipData && ratios.length > 0) {
    // Second best: use VIP-to-Merch ratio from artists where we have both
    const avgRatio = ratios.reduce((sum, r) => sum + r.ratio, 0) / ratios.length
    const projectedMonthly = totalVipRevenue * avgRatio
    monthlyLow = Math.round(projectedMonthly * 0.5)
    monthlyMid = Math.round(projectedMonthly)
    monthlyHigh = Math.round(projectedMonthly * 1.8)
  } else if (hasVipData) {
    // Have VIP data but no merch ratio yet — use VIP revenue as proxy
    // Avg merch is roughly 3-5% of VIP revenue per month (rough heuristic)
    const estimate = totalVipRevenue * 0.04 / 12
    monthlyLow = Math.round(estimate * 0.5)
    monthlyMid = Math.round(estimate)
    monthlyHigh = Math.round(estimate * 2)
  } else {
    // No VIP data — fall back to CM score band averages
    let bandKey = 'unknown'
    if (cm >= 90) bandKey = '90+'
    else if (cm >= 80) bandKey = '80-89'
    else if (cm >= 70) bandKey = '70-79'
    else if (cm >= 60) bandKey = '60-69'
    else bandKey = '<60'

    const bandAvgRev = bands[bandKey]?.avgRevenue ?? 100000
    // Estimate merch as ~4% of VIP revenue, monthly
    const estimate = bandAvgRev * 0.04 / 12
    monthlyLow = Math.round(estimate * 0.5)
    monthlyMid = Math.round(Math.max(estimate, 500))
    monthlyHigh = Math.round(estimate * 2.5)
  }

  // Ensure minimums
  monthlyLow = Math.max(monthlyLow, 100)
  monthlyMid = Math.max(monthlyMid, 300)
  monthlyHigh = Math.max(monthlyHigh, 500)

  // ── RISK ASSESSMENT — factors in the front amount ──
  const breakEvenMonths = monthlyMid > 0 ? frontAmount / monthlyMid : 999

  let risk: MerchEvaluation['risk']
  if (breakEvenMonths > 24 || (engagement < 25 && !hasVipData)) {
    risk = 'pass'
  } else if (breakEvenMonths > 18 || (engagement < 40 && !hasVipData)) {
    risk = 'high'
  } else if (breakEvenMonths <= 6 && engagement >= 50) {
    risk = 'low'
  } else if (breakEvenMonths <= 12) {
    risk = hasVipData ? 'low' : 'moderate'
  } else {
    risk = 'moderate'
  }

  // ── SUMMARY ──
  const dataConfidence = hasVipData
    ? bench?.shopify_monthly_revenue ? 'Based on actual P&TY VIP ticket sales AND merch store data for this artist.'
    : 'Based on actual P&TY VIP ticket sales data for this artist.'
    : 'Estimated from CM score and comparable artist benchmarks. No direct VIP sales data available.'

  const summaries: Record<string, string> = {
    low: `${dataConfidence} Break-even projected at ${Math.ceil(breakEvenMonths)} months. Strong risk/reward profile at the proposed front amount.`,
    moderate: `${dataConfidence} Break-even projected at ${Math.ceil(breakEvenMonths)} months. Consider negotiating the front amount or starting with a limited test order.`,
    high: `${dataConfidence} Break-even projected at ${Math.ceil(breakEvenMonths)} months. Front amount of $${frontAmount.toLocaleString()} exceeds comfortable risk threshold. Recommend restructuring deal terms.`,
    pass: `${dataConfidence} Break-even exceeds 24 months at projected revenue. Recommend declining or limiting to zero-risk consignment model only.`,
  }

  // ── KEY FACTORS ──
  const factors: MerchEvaluation['factors'] = []

  if (hasVipData) {
    factors.push({ type: 'positive', text: `<strong>Real VIP sales data available</strong> — ${totalVipOrders.toLocaleString()} orders, $${Math.round(totalVipRevenue).toLocaleString()} total VIP revenue across ${(bench?.tm_event_count ?? 0) + (bench?.axs_event_count ?? 0)} events` })
    if (totalVipRevenue > 500000) factors.push({ type: 'positive', text: `<strong>Top-tier VIP performer</strong> — revenue places this artist in the top 10% of P&TY's portfolio` })
  } else {
    factors.push({ type: 'neutral', text: `<strong>No P&TY VIP sales history</strong> — projections based on CM score and comparable artist benchmarks. Confidence is lower.` })
  }

  if (bench?.shopify_monthly_revenue) {
    factors.push({ type: 'positive', text: `<strong>Actual merch store data</strong> — averaging $${Math.round(bench.shopify_monthly_revenue).toLocaleString()}/mo in merch revenue` })
  }

  if (breakEvenMonths > 18) {
    factors.push({ type: 'negative', text: `<strong>Front amount concern</strong> — $${frontAmount.toLocaleString()} front requires ${Math.ceil(breakEvenMonths)} months to recoup at projected mid-range revenue. Consider reducing to $${Math.round(monthlyMid * 12 * 0.6).toLocaleString()} or less.` })
  }

  if (engagement >= 60) factors.push({ type: 'positive', text: `<strong>Strong fan engagement</strong> — social following and VIP purchasing patterns suggest an active, spending-ready fanbase` })
  if (engagement < 30 && !hasVipData) factors.push({ type: 'negative', text: `<strong>Low engagement</strong> — limited social activity suggests a passive audience unlikely to convert to merch sales` })
  if (momentum >= 60) factors.push({ type: 'positive', text: `<strong>Career momentum</strong> — streaming and social metrics trending upward, which correlates with merch demand` })
  if (momentum < 30) factors.push({ type: 'negative', text: `<strong>Declining momentum</strong> — streaming metrics flat or declining, limiting new fan acquisition and merch interest` })
  if (touring >= 70) factors.push({ type: 'positive', text: `<strong>Active touring</strong> — consistent live shows create direct merch sales opportunities` })
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
  const [vipEvaluation, setVipEvaluation] = useState<VipEvaluation | null>(null)
  const [artistData, setArtistData] = useState<ArtistResult | null>(null)
  const [error, setError] = useState('')

  // VIP Merch specific inputs
  const [numShows, setNumShows] = useState('20')
  const [packagesPerShow, setPackagesPerShow] = useState('200')
  const [avgLiftPrice, setAvgLiftPrice] = useState('200')
  const [merchCOGS, setMerchCOGS] = useState('40')

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
    setVipEvaluation(null)

    const front = parseInt(frontAmount.replace(/[^0-9]/g, '')) || 50000

    try {
      // Step 1: Find artist in our DB
      const res = await fetch(`/api/artists?search=${encodeURIComponent(artistName.trim())}&limit=1`)
      const data = await res.json()
      let artists: ArtistResult[] = data.artists || []

      // Step 2: If not in DB, try CM search (which also stores the artist)
      if (artists.length === 0) {
        const cmRes = await fetch(`/api/sync/chartmetric?search=${encodeURIComponent(artistName.trim())}`)
        if (cmRes.ok) {
          const cmData = await cmRes.json()
          if (cmData.chartmetric_id) {
            artists = [cmData]
          }
        }
      }

      if (artists.length === 0) {
        setError(`No artist found matching "${artistName}". Try a different name.`)
        setSearching(false)
        return
      }

      const artist = artists[0]
      setArtistData(artist)

      // Step 3: Fetch benchmark data for this artist
      let benchmarks: BenchmarkData | null = null
      try {
        const benchRes = await fetch(`/api/merch/benchmarks?artist=${encodeURIComponent(artist.name)}`)
        if (benchRes.ok) {
          benchmarks = await benchRes.json()
        }
      } catch { /* proceed without benchmarks */ }

      // Step 4: Evaluate based on deal type
      if (dealType === 'vip-merch') {
        setVipEvaluation(evaluateVipMerch(
          artist,
          front,
          parseInt(numShows) || 20,
          parseInt(packagesPerShow) || 200,
          parseInt(avgLiftPrice.replace(/[^0-9]/g, '')) || 200,
          parseInt(merchCOGS.replace(/[^0-9]/g, '')) || 40,
          benchmarks,
        ))
      } else {
        setEvaluation(evaluateArtist(artist, front, benchmarks))
      }
    } catch {
      setError('Something went wrong. Try again.')
    }
    setSearching(false)
  }

  const front = parseInt(frontAmount.replace(/[^0-9]/g, '')) || 50000

  const riskColors = { low: GREEN, moderate: Y, high: RED, pass: '#666' }
  const riskBg = { low: '#1a2e1a', moderate: '#2e2a1a', high: '#2e1a1a', pass: '#1a1a1a' }

  // Determine if we should show "coming soon" instead of results
  const isComingSoon = dealType === 'tour-merch' || dealType === 'collab'
  const isVip = dealType === 'vip-merch'
  const isEcomm = dealType === 'ecomm'

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

          {/* VIP Merch Specific Inputs */}
          {isVip && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 md:gap-6">
              <div>
                <label className="block mb-2.5 text-[11px] sm:text-[13px] tracking-[4px] uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>
                  Number of Shows
                </label>
                <input
                  type="text"
                  value={numShows}
                  onChange={e => setNumShows(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="20"
                  className="w-full px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-7 text-[24px] sm:text-[36px] md:text-[48px] tracking-wider rounded-md border-2 border-[#3a3a3a] focus:border-[#F9D40A] transition-colors placeholder:text-[#555] outline-none"
                  style={{ background: SURFACE, color: '#f5f4f2', fontFamily: "'Bebas Neue', sans-serif" }}
                />
              </div>
              <div>
                <label className="block mb-2.5 text-[11px] sm:text-[13px] tracking-[4px] uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>
                  Packages / Show
                </label>
                <input
                  type="text"
                  value={packagesPerShow}
                  onChange={e => setPackagesPerShow(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="200"
                  className="w-full px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-7 text-[24px] sm:text-[36px] md:text-[48px] tracking-wider rounded-md border-2 border-[#3a3a3a] focus:border-[#F9D40A] transition-colors placeholder:text-[#555] outline-none"
                  style={{ background: SURFACE, color: '#f5f4f2', fontFamily: "'Bebas Neue', sans-serif" }}
                />
              </div>
              <div>
                <label className="block mb-2.5 text-[11px] sm:text-[13px] tracking-[4px] uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>
                  Avg Lift Price
                </label>
                <input
                  type="text"
                  value={`$${parseInt(avgLiftPrice || '0').toLocaleString()}`}
                  onChange={e => setAvgLiftPrice(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="$200"
                  className="w-full px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-7 text-[24px] sm:text-[36px] md:text-[48px] tracking-wider rounded-md border-2 border-[#3a3a3a] focus:border-[#F9D40A] transition-colors placeholder:text-[#555] outline-none"
                  style={{ background: SURFACE, color: '#f5f4f2', fontFamily: "'Bebas Neue', sans-serif" }}
                />
              </div>
              <div>
                <label className="block mb-2.5 text-[11px] sm:text-[13px] tracking-[4px] uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>
                  Merch COGS / Pkg
                </label>
                <input
                  type="text"
                  value={`$${parseInt(merchCOGS || '0').toLocaleString()}`}
                  onChange={e => setMerchCOGS(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="$40"
                  className="w-full px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-7 text-[24px] sm:text-[36px] md:text-[48px] tracking-wider rounded-md border-2 border-[#3a3a3a] focus:border-[#F9D40A] transition-colors placeholder:text-[#555] outline-none"
                  style={{ background: SURFACE, color: '#f5f4f2', fontFamily: "'Bebas Neue', sans-serif" }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Evaluate Button */}
        {isComingSoon ? (
          <div className="w-full py-5 sm:py-6 md:py-7 px-8 md:px-12 text-center text-[20px] sm:text-[28px] md:text-[36px] tracking-[4px] md:tracking-[6px] rounded-md mt-2" style={{ background: '#2a2a2a', color: '#666', fontFamily: "'Bebas Neue', sans-serif" }}>
            MODEL COMING SOON
          </div>
        ) : (
          <button
            onClick={handleEvaluate}
            disabled={searching || !artistName.trim()}
            className="w-full py-5 sm:py-6 md:py-7 px-8 md:px-12 text-[20px] sm:text-[28px] md:text-[36px] tracking-[4px] md:tracking-[6px] rounded-md mt-2 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all border-none cursor-pointer"
            style={{ background: Y, color: '#1B1B1B', fontFamily: "'Bebas Neue', sans-serif" }}
          >
            {searching ? 'SEARCHING...' : 'EVALUATE RISK \u2192'}
          </button>
        )}

        {isComingSoon && (
          <div className="mt-5 md:mt-6 p-4 md:p-5 rounded-md text-sm md:text-[15px]" style={{ background: '#1a1a2e', borderLeft: `4px solid ${BLUE}`, color: '#888' }}>
            {dealType === 'tour-merch'
              ? 'Tour Merch model coming soon — contact the merch team for custom projections.'
              : 'Limited Collab Drop model coming soon — contact the merch team for custom projections.'}
          </div>
        )}

        {error && (
          <div className="mt-5 md:mt-6 p-4 md:p-5 rounded-md text-sm md:text-[15px]" style={{ background: '#2e1a1a', borderLeft: `4px solid ${RED}`, color: '#f5f4f2' }}>
            {error}
          </div>
        )}

        {/* ── VIP MERCH RESULTS ── */}
        {isVip && vipEvaluation && artistData && (
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
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 p-4 px-5 sm:p-5 sm:px-6 md:p-6 md:px-8 mb-6 md:mb-7 rounded-md" style={{ borderLeft: `6px solid ${riskColors[vipEvaluation.risk]}`, background: riskBg[vipEvaluation.risk] }}>
              <div className="text-[32px] sm:text-[40px] md:text-[48px] tracking-[3px]" style={{ fontFamily: "'Bebas Neue', sans-serif", color: riskColors[vipEvaluation.risk] }}>
                {vipEvaluation.risk.toUpperCase()}
              </div>
              <div className="text-[13px] md:text-[15px] leading-relaxed sm:text-right sm:max-w-[400px]" style={{ color: '#888' }}>
                {vipEvaluation.summary}
              </div>
            </div>

            {/* VIP Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-7">
              {[
                { label: 'CM Score', value: String(vipEvaluation.cmScore), sub: vipEvaluation.tier, accent: Y },
                { label: 'Total Packages', value: vipEvaluation.totalPackages.toLocaleString(), sub: `${numShows} shows \u00D7 ${packagesPerShow}/show`, accent: BLUE },
                { label: 'Break-Even Sellthrough', value: vipEvaluation.breakEvenSellthrough !== null ? `${vipEvaluation.breakEvenSellthrough.toFixed(1)}%` : 'N/A', sub: vipEvaluation.breakEvenSellthrough !== null ? 'To recoup front' : 'Cannot recoup', accent: vipEvaluation.breakEvenSellthrough !== null && vipEvaluation.breakEvenSellthrough <= 75 ? GREEN : RED },
                { label: 'Recommended Max Front', value: `$${vipEvaluation.recommendedMaxFront.toLocaleString()}`, sub: '75% sellthrough \u00D7 80%', accent: '#f5f4f2' },
              ].map((m, i) => (
                <div key={i} className="relative overflow-hidden p-4 md:p-6 rounded-md" style={{ background: SURFACE, border: '1px solid #333' }}>
                  <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: m.accent }} />
                  <div className="text-[10px] md:text-[11px] tracking-[2px] md:tracking-[3px] uppercase mb-1.5 md:mb-2" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>{m.label}</div>
                  <div className="text-[28px] sm:text-[36px] md:text-[44px] leading-none tracking-[1px]" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>{m.value}</div>
                  <div className="text-[11px] md:text-[13px] mt-1 md:mt-1.5" style={{ color: '#666' }}>{m.sub}</div>
                </div>
              ))}
            </div>

            {/* VIP Sellthrough Projection Table */}
            <div className="p-5 md:p-7 rounded-md mb-6 md:mb-7 overflow-x-auto" style={{ background: SURFACE, border: '1px solid #333' }}>
              <h3 className="text-lg md:text-xl tracking-[2px] mb-4 md:mb-5" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>SELLTHROUGH PROJECTIONS</h3>
              <table className="w-full min-w-[700px]" style={{ borderCollapse: 'collapse' as const }}>
                <thead>
                  <tr>
                    {['Scenario', 'Sellthrough', 'Gross', 'Net to Split', 'P&TY Share', 'Artist Share', 'vs Front'].map(h => (
                      <th key={h} className="text-left text-[10px] md:text-[11px] tracking-[2px] md:tracking-[3px] uppercase pb-3 border-b border-[#333]" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#888' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vipEvaluation.rows.map(row => {
                    const rowColor = row.sellthrough <= 0.50 ? RED : row.sellthrough <= 0.75 ? Y : GREEN
                    return (
                      <tr key={row.label}>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-sm md:text-base tracking-[2px]" style={{ fontFamily: "'Bebas Neue', sans-serif", color: rowColor }}>{row.label}</td>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-base md:text-lg font-medium" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#f5f4f2' }}>{Math.round(row.sellthrough * 100)}%</td>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-base md:text-lg font-medium" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#f5f4f2' }}>${row.gross.toLocaleString()}</td>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-base md:text-lg font-medium" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#f5f4f2' }}>${row.netToSplit.toLocaleString()}</td>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-base md:text-lg font-medium" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#f5f4f2' }}>${row.ptyShare.toLocaleString()}</td>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-base md:text-lg font-medium" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: '#f5f4f2' }}>${row.artistShare.toLocaleString()}</td>
                        <td className="py-3 md:py-3.5 border-b border-[#2a2a2a] text-base md:text-lg font-medium" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: row.vsFront >= 0 ? GREEN : RED }}>
                          {row.vsFront >= 0 ? '+' : ''}{row.vsFront < 0 ? '-' : ''}${Math.abs(row.vsFront).toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Key Factors */}
            <div className="p-5 md:p-7 rounded-md" style={{ background: SURFACE, border: '1px solid #333' }}>
              <h3 className="text-lg md:text-xl tracking-[2px] mb-3 md:mb-4" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#f5f4f2' }}>KEY FACTORS</h3>
              {vipEvaluation.factors.map((f, i) => (
                <div key={i} className="flex items-start gap-3 py-3" style={{ borderBottom: i < vipEvaluation.factors.length - 1 ? '1px solid #2a2a2a' : 'none' }}>
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

        {/* ── E-COMMERCE STORE RESULTS (original model) ── */}
        {isEcomm && evaluation && artistData && (
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
