'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'

// ── Brand colors ──────────────────────────────────────
const Y = '#F9D40A'
const BG = '#0f0f0f'
const SURFACE = '#141414'
const SURFACE2 = '#1C1C1C'
const SURFACE3 = '#242424'
const BORDER = 'rgba(255,255,255,0.08)'
const W80 = 'rgba(255,255,255,0.8)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'
const BLUE = '#60bae1'
const PINK = '#ec989c'
const GREEN = '#00D26A'

const STAGE_COLORS: Record<string, string> = {
  'Outbound - No Contact': '#666',
  'Outbound - Automated Contact': '#666',
  'Prospect - Direct Sales Agent Contact': BLUE,
  'Active Leads (Contact Has Responded)': BLUE,
  'Proposal (financials submitted)': Y,
  'Negotiation (Terms Being Discussed)': Y,
  'Finalizing On-Sale (Terms Agreed)': GREEN,
  'Won (Final On-Sale Planned)': GREEN,
  'Lost': '#FF4444',
}

const CAREER_COLORS: Record<string, string> = {
  legendary: '#ef4444',
  superstar: '#f97316',
  mainstream: '#F9D40A',
  'mid-level': '#00D26A',
  developing: '#4A9EFF',
  undiscovered: 'rgba(255,255,255,0.3)',
}
const CAREER_STAGES = ['Undiscovered', 'Developing', 'Mid-Level', 'Mainstream', 'Superstar', 'Legendary']

const ETHNICITY_LABELS: Record<string, string> = {
  white: 'White / Caucasian',
  hispanic: 'Hispanic',
  african_american: 'Black / African American',
  asian: 'Asian',
  other: 'Other',
  middle_eastern: 'Middle Eastern',
  native_american: 'Native American',
}

const EVENT_TYPE_CONFIG: Record<string, { color: string; icon: string }> = {
  festival_added:    { color: Y,     icon: '🎪' },
  album_presave:     { color: BLUE,  icon: '💿' },
  stage_change:      { color: GREEN, icon: '📈' },
  added_to_pipeline: { color: GREEN, icon: '✅' },
  metric_spike:      { color: BLUE,  icon: '⚡' },
}

// ── Types ─────────────────────────────────────────────
interface ArtistDetail {
  chartmetric_id: number
  name: string
  image_url: string | null
  career_stage: string | null
  cm_score: number | null
  primary_genre: string | null
  spotify_followers: number | null
  spotify_monthly_listeners: number | null
  instagram_followers: number | null
  youtube_subscribers: number | null
  tiktok_followers: number | null
  audience_male_pct: number | null
  audience_female_pct: number | null
  age_13_17_pct: number | null
  age_18_24_pct: number | null
  age_25_34_pct: number | null
  age_35_44_pct: number | null
  age_45_64_pct: number | null
  age_65_plus_pct: number | null
  audience_ethnicity: Record<string, number> | null
  top_countries: Array<{ country: string; code: string; pct: number }> | null
  general_manager: string | null
}

interface Brand { brand_name: string; affinity_scale: number; interest_category: string | null }
interface Sector { sector_name: string; affinity_scale: number }

interface Deal {
  id: string
  tour: string | null
  stage: string | null
  total_events: number | null
  first_show: string | null
  last_show: string | null
  proj_gross: number | null
  proj_pty_net: number | null
  sales_lead: string | null
}

interface Contact {
  id: string
  role: string
  contact_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  source: string | null
}

interface ActivityEntry {
  id: string
  event_type: string
  event_title: string
  event_detail: Record<string, any> | null
  event_date: string | null
  created_at: string
}

// ── Helpers ───────────────────────────────────────────
function formatNum(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatMoney(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${Math.round(n)}%`
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌍'
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)))
}

function stageIndex(stage: string | null): number {
  if (!stage) return -1
  return CAREER_STAGES.findIndex(s => stage.toLowerCase().includes(s.toLowerCase()))
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function formatDateFull(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Donut chart (SVG) ─────────────────────────────────
function DonutChart({ male, female }: { male: number; female: number }) {
  const r = 36
  const cx = 50
  const cy = 50
  const circumference = 2 * Math.PI * r
  const maleDash = (male / 100) * circumference
  const femaleDash = (female / 100) * circumference
  const gap = 2

  return (
    <svg viewBox="0 0 100 100" className="w-36 h-36">
      {/* Female arc (background) */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={PINK} strokeWidth="10"
        strokeDasharray={`${femaleDash - gap} ${circumference - femaleDash + gap}`}
        strokeDashoffset={-(maleDash + gap / 2)}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50px 50px' }}
      />
      {/* Male arc */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={BLUE} strokeWidth="10"
        strokeDasharray={`${maleDash - gap} ${circumference - maleDash + gap}`}
        strokeDashoffset={0}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50px 50px' }}
      />
      {/* Center label */}
      <text x="50" y="46" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">{Math.round(male)}%</text>
      <text x="50" y="58" textAnchor="middle" fill={W30} fontSize="7">MALE</text>
    </svg>
  )
}

// ── Butterfly chart ───────────────────────────────────
function ButterflyChart({ artist }: { artist: ArtistDetail }) {
  const malePct = artist.audience_male_pct ?? 50
  const femalePct = artist.audience_female_pct ?? 50

  const ageRows = [
    { label: '13–17', total: artist.age_13_17_pct ?? 0 },
    { label: '18–24', total: artist.age_18_24_pct ?? 0 },
    { label: '25–34', total: artist.age_25_34_pct ?? 0 },
    { label: '35–44', total: artist.age_35_44_pct ?? 0 },
    { label: '45–64', total: artist.age_45_64_pct ?? 0 },
    { label: '65+',   total: artist.age_65_plus_pct ?? 0 },
  ]
  const maxVal = Math.max(...ageRows.map(r => r.total), 1)

  return (
    <div>
      {/* Donut + legend — centered */}
      <div className="flex flex-col items-center mb-6">
        <DonutChart male={malePct} female={femalePct} />
        <div className="flex gap-5 mt-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: BLUE }} />
            <span className="text-sm font-bold text-white">{formatPct(malePct)}</span>
            <span className="text-xs" style={{ color: W30 }}>Male</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PINK }} />
            <span className="text-sm font-bold text-white">{formatPct(femalePct)}</span>
            <span className="text-xs" style={{ color: W30 }}>Female</span>
          </div>
        </div>
      </div>
      <div className="text-xs uppercase tracking-wider mb-3" style={{ color: W30 }}>Age Breakdown</div>

      {/* Butterfly bars */}
      {ageRows.map(row => {
        const pct = (row.total / maxVal) * 100
        const maleW = pct * (malePct / 100)
        const femaleW = pct * (femalePct / 100)
        return (
          <div key={row.label} className="flex items-center gap-1 mb-1.5">
            <div className="flex-1 flex justify-end">
              <div className="h-4 rounded-l" style={{ width: `${maleW}%`, minWidth: row.total > 0 ? 3 : 0, background: BLUE }} />
            </div>
            <div className="text-xs w-10 text-center shrink-0" style={{ color: W50 }}>{row.label}</div>
            <div className="flex-1">
              <div className="h-4 rounded-r" style={{ width: `${femaleW}%`, minWidth: row.total > 0 ? 3 : 0, background: PINK }} />
            </div>
            <div className="text-xs w-7 text-right font-mono shrink-0" style={{ color: W30 }}>{formatPct(row.total)}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Affinity table ────────────────────────────────────
function AffinityTable({ items, labelKey, valueKey }: { items: any[]; labelKey: string; valueKey: string }) {
  const max = items.length > 0 ? Math.max(...items.map(i => i[valueKey])) : 1
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th className="text-left text-xs uppercase tracking-wider pb-2" style={{ color: W30, borderBottom: `1px solid ${W30}`, fontWeight: 500 }}>
            {labelKey === 'brand_name' ? 'Brand' : 'Sector'}
          </th>
          <th className="pb-2 hidden sm:table-cell" style={{ borderBottom: `1px solid ${W30}` }} />
          <th className="text-right text-xs uppercase tracking-wider pb-2" style={{ color: W30, borderBottom: `1px solid ${W30}`, fontWeight: 500 }}>Index</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => {
          const val: number = item[valueKey]
          const isHigh = val >= 2.0
          const barPct = (val / max) * 100
          return (
            <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
              <td className="py-2.5 text-sm pr-4" style={{ color: W80 }}>{item[labelKey]}</td>
              <td className="py-2.5 hidden sm:table-cell" style={{ width: '120px' }}>
                <div className="h-1 rounded overflow-hidden" style={{ background: BORDER }}>
                  <div className="h-full rounded" style={{ width: `${barPct}%`, background: Y }} />
                </div>
              </td>
              <td className="py-2.5 text-right text-sm font-bold font-mono" style={{ color: isHigh ? Y : W50 }}>
                {val.toFixed(2)}x
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Contact card ──────────────────────────────────────
function ContactRow({ icon, text, onCopy, href }: { icon: string; text: string; onCopy?: () => void; href?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 py-1.5 border-t" style={{ borderColor: BORDER }}>
      <div className="w-7 h-7 rounded-md flex items-center justify-center text-xs shrink-0" style={{ background: BORDER }}>{icon}</div>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="flex-1 text-sm truncate hover:underline" style={{ color: W80 }}>{text}</a>
      ) : (
        <span className="flex-1 text-sm truncate" style={{ color: W80 }}>{text}</span>
      )}
      {onCopy && (
        <button onClick={() => { onCopy(); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="w-7 h-7 rounded-md border flex items-center justify-center text-xs shrink-0 transition-colors"
          style={{ background: copied ? `${Y}22` : 'transparent', borderColor: copied ? Y : BORDER, color: copied ? Y : W30 }}>
          {copied ? '✓' : '⎘'}
        </button>
      )}
    </div>
  )
}

function ContactCard({ contact, onCopy }: { contact: Contact; onCopy: (t: string) => void }) {
  const roleLabel = contact.role === 'business_manager' ? 'Business Manager' : contact.role === 'agent' ? 'Agent' : 'Manager'
  return (
    <div className="rounded-xl p-4 border" style={{ background: SURFACE, borderColor: BORDER }}>
      <div className="text-xs uppercase tracking-widest mb-2" style={{ color: W30 }}>{roleLabel}</div>
      {contact.contact_name && <div className="text-base font-semibold mb-0.5 text-white">{contact.contact_name}</div>}
      {contact.company_name && <div className="text-sm mb-3" style={{ color: Y }}>{contact.company_name}</div>}
      {contact.email && <ContactRow icon="@" text={contact.email} onCopy={() => onCopy(contact.email!)} />}
      {contact.phone && <ContactRow icon="☎" text={contact.phone} onCopy={() => onCopy(contact.phone!)} />}
      {contact.linkedin_url && <ContactRow icon="in" text="LinkedIn" href={contact.linkedin_url} />}
      {contact.source && (
        <span className="inline-block text-xs uppercase tracking-wider mt-2 px-2 py-0.5 rounded" style={{ background: BORDER, color: W30 }}>
          {contact.source}
        </span>
      )}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────
function Spinner() {
  return <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: Y, borderTopColor: 'transparent' }} />
}

// ── Tour deals summary (collapsible) ─────────────────
function TourSummary({ deals }: { deals: Deal[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const totalEvents = deals.reduce((sum, d) => sum + (d.total_events ?? 0), 0)
  const totalGross = deals.reduce((sum, d) => sum + (d.proj_gross ?? 0), 0)
  const activeDeal = deals.find(d => d.stage && !d.stage.includes('Lost')) ?? deals[0]
  const stageColor = activeDeal?.stage ? (STAGE_COLORS[activeDeal.stage] ?? W50) : W50

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-3 flex-wrap text-sm rounded-xl px-4 py-3 border w-full text-left transition-colors hover:border-white/20"
        style={{ background: SURFACE, borderColor: open ? W30 : BORDER }}
      >
        {activeDeal?.stage && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ background: `${stageColor}22`, color: stageColor }}>
            {activeDeal.stage}
          </span>
        )}
        <span className="font-medium text-white">{totalEvents} events</span>
        {totalGross > 0 && (
          <span style={{ color: W50 }}>Proj. gross {formatMoney(totalGross)}</span>
        )}
        {deals.length > 1 && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: BORDER, color: W30 }}>
            {deals.length} legs
          </span>
        )}
        <svg className="ml-auto w-4 h-4 shrink-0 transition-transform" style={{ color: W30, transform: open ? 'rotate(180deg)' : 'none' }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border z-20 overflow-hidden"
          style={{ background: SURFACE2, borderColor: BORDER }}>
          {deals.map((deal, i) => (
            <div key={deal.id} className="px-4 py-3 border-b last:border-0 text-sm" style={{ borderColor: BORDER }}>
              <div className="flex items-center gap-3 flex-wrap">
                {deal.stage && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: `${STAGE_COLORS[deal.stage] ?? W30}22`, color: STAGE_COLORS[deal.stage] ?? W50 }}>
                    {deal.stage}
                  </span>
                )}
                <span className="font-medium text-white">{deal.tour ?? 'Untitled'}</span>
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs flex-wrap" style={{ color: W50 }}>
                {deal.total_events != null && <span>{deal.total_events} events</span>}
                {deal.proj_gross != null && <span>{formatMoney(deal.proj_gross)} proj. gross</span>}
                {deal.first_show && <span>{formatDate(deal.first_show)} – {formatDate(deal.last_show)}</span>}
                {deal.sales_lead && <span>Lead: {deal.sales_lead}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────
export default function ArtistPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string

  const [artist, setArtist] = useState<ArtistDetail | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'contacts' | 'intelligence' | 'activity' | 'pitch'>('contacts')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (tab && ['contacts', 'intelligence', 'activity', 'pitch'].includes(tab)) {
      setActiveTab(tab as any)
    }
  }, [])
  const [intelTab, setIntelTab] = useState<'brands' | 'sectors'>('brands')
  const [copyMsg, setCopyMsg] = useState('')
  const [pitchInput, setPitchInput] = useState('')
  const [pitchOutput, setPitchOutput] = useState('')
  const [pitchLoading, setPitchLoading] = useState(false)

  useEffect(() => {
    if (!id) return
    fetch(`/api/artists/${id}`)
      .then(r => r.json())
      .then(data => {
        setArtist(data.artist)
        setBrands(data.brands || [])
        setSectors(data.sectors || [])
        setDeals(data.deals || [])
        setContacts(data.contacts || [])
        setActivity(data.activity || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopyMsg('Copied!')
    setTimeout(() => setCopyMsg(''), 1500)
  }

  const handleGeneratePitch = async () => {
    if (!pitchInput.trim() || !artist) return
    setPitchLoading(true)
    setPitchOutput('')
    try {
      const context = `
Artist: ${artist.name}
Genre: ${artist.primary_genre ?? 'Unknown'}
Career Stage: ${artist.career_stage ?? 'Unknown'}
Chartmetric Score: ${artist.cm_score ?? 'N/A'}
Spotify Followers: ${formatNum(artist.spotify_followers)}
Instagram Followers: ${formatNum(artist.instagram_followers)}
TikTok Followers: ${formatNum(artist.tiktok_followers)}
Audience: ${formatPct(artist.audience_male_pct)} Male, ${formatPct(artist.audience_female_pct)} Female
Top Age Groups: 18-24 (${formatPct(artist.age_18_24_pct)}), 25-34 (${formatPct(artist.age_25_34_pct)})
Top Markets: ${artist.top_countries?.slice(0,3).map(c => c.country).join(', ') ?? 'Unknown'}
Top Brand Affinities: ${brands.slice(0,5).map(b => `${b.brand_name} (${b.affinity_scale.toFixed(1)}x)`).join(', ')}
Top Sectors: ${sectors.slice(0,5).map(s => s.sector_name).join(', ')}
${deals.length > 0 ? `Tours: ${deals.map(d => `${d.tour ?? 'Untitled'} (${d.total_events ?? '?'} events${d.proj_gross ? ', proj. gross ' + formatMoney(d.proj_gross) : ''})`).join(', ')}` : ''}
      `.trim()

      const res = await fetch('/api/pitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: pitchInput, context }),
      })
      const data = await res.json()
      setPitchOutput(data.pitch ?? data.error ?? 'No response.')
    } catch {
      setPitchOutput('Failed to generate pitch. Please try again.')
    }
    setPitchLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BG }}>
        <Spinner />
      </div>
    )
  }

  if (!artist) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ background: BG, color: W50 }}>
        Artist not found.
      </div>
    )
  }

  const stageIdx = stageIndex(artist.career_stage)
  const activeDeal = deals.find(d => d.stage && !d.stage.includes('Lost')) ?? deals[0]
  const stageColor = activeDeal?.stage ? (STAGE_COLORS[activeDeal.stage] ?? W50) : W50

  const ethnicityRows = artist.audience_ethnicity
    ? Object.entries(artist.audience_ethnicity)
        .map(([k, v]) => ({ label: ETHNICITY_LABELS[k] ?? k, value: v as number }))
        .filter(r => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)
    : []

  const managers = contacts.filter(c => c.role === 'manager')
  const agents = contacts.filter(c => c.role === 'agent')
  const bizManagers = contacts.filter(c => c.role === 'business_manager')

  const TABS = [
    { id: 'contacts' as const, label: `Contacts${contacts.length > 0 ? ` (${contacts.length})` : ''}` },
    { id: 'activity' as const, label: 'Activity' },
    { id: 'intelligence' as const, label: 'Intelligence' },
    { id: 'pitch' as const, label: '⚡ Pitch Builder' },
  ]

  return (
    <div className="min-h-screen" style={{ background: BG, fontFamily: 'system-ui, sans-serif' }}>

      {/* NAV */}
<nav className="flex items-center gap-4 px-5 py-3 border-b sticky top-0 z-50"
  style={{ background: BG, borderColor: BORDER }}>
  <img src="/pty-logo.svg" alt="P&TY" className="h-7 w-auto shrink-0" />
  <div className="h-4 w-px shrink-0" style={{ backgroundColor: BORDER }} />
  <a href="/" className="text-sm transition-colors hover:text-white" style={{ color: W50 }}>
    Roster
  </a>
  <a href="/discovery" className="text-sm transition-colors hover:text-white" style={{ color: W50 }}>
    Discovery
  </a>
  <a href="/brand-search" className="text-sm transition-colors hover:text-white" style={{ color: W50 }}>
    Brand Search
  </a>
  {copyMsg && <span className="ml-auto text-xs font-semibold" style={{ color: GREEN }}>{copyMsg}</span>}
</nav>

      <div className="px-5 py-6 max-w-5xl mx-auto">

        {/* ── HERO ── */}
        <div className="flex items-start gap-5 mb-5">
          <div className="w-28 h-28 shrink-0 rounded-xl overflow-hidden border" style={{ borderColor: BORDER }}>
            {artist.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={artist.image_url} alt={artist.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl font-bold"
                style={{ background: SURFACE3, color: W30 }}>{artist.name[0]}</div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest mb-1" style={{ color: W30 }}>
              {artist.primary_genre?.split(',')[0]?.trim() ?? '—'}
            </div>
            <h1 className="font-bold leading-none mb-3 text-white"
              style={{ fontSize: 'clamp(26px, 4vw, 40px)', letterSpacing: '-0.02em' }}>
              {artist.name}
            </h1>

            {/* Score + stage */}
            <div className="flex items-center flex-wrap gap-5 mb-3">
              <div>
                <div className="text-2xl font-bold font-mono leading-none" style={{ color: Y }}>
                  {artist.cm_score != null ? Math.round(artist.cm_score) : '—'}
                </div>
                <div className="text-xs tracking-wider mt-0.5" style={{ color: W30 }}>CM SCORE</div>
              </div>
              {activeDeal?.stage && (
                <div>
                  <div className="text-sm font-semibold" style={{ color: stageColor }}>{activeDeal.stage}</div>
                  <div className="text-xs tracking-wider mt-0.5" style={{ color: W30 }}>DEAL STAGE</div>
                </div>
              )}
            </div>

            {/* Social stats */}
            <div className="flex items-center flex-wrap gap-5 mb-4">
              {[
                { label: 'SPOTIFY', value: formatNum(artist.spotify_followers) },
                { label: 'INSTAGRAM', value: formatNum(artist.instagram_followers) },
                { label: 'TIKTOK', value: formatNum(artist.tiktok_followers) },
                { label: 'YOUTUBE', value: formatNum(artist.youtube_subscribers) },
              ].map(s => (
                <div key={s.label}>
                  <div className="font-bold text-lg leading-none text-white">{s.value}</div>
                  <div className="text-xs tracking-wider" style={{ color: W30 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Career stage bar */}
            <div>
              <div className="text-xs tracking-widest mb-1.5" style={{ color: W30 }}>CAREER STAGE</div>
              <div className="flex items-start gap-0.5">
                {CAREER_STAGES.map((stage, i) => {
                  const isActive = i === stageIdx
                  const isPast = i < stageIdx
                  return (
                    <div key={stage} className="flex-1 flex flex-col gap-1">
                      <div className="h-1 rounded-sm" style={{ background: isActive ? (CAREER_COLORS[stage.toLowerCase()] ?? Y) : isPast ? '#555' : BORDER }} />
                      <div className="text-center hidden sm:block"
                        style={{ fontSize: '8px', letterSpacing: '0.05em', color: isActive ? (CAREER_COLORS[stage.toLowerCase()] ?? Y) : '#4b5563' }}>
                        {stage.toUpperCase()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Tour deals — collapsible summary */}
        {deals.length > 0 && <div className="mb-6"><TourSummary deals={deals} /></div>}

        {/* ── TABS ── */}
        <div className="flex gap-0 border-b mb-6 overflow-x-auto" style={{ borderColor: BORDER }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap"
              style={{ color: activeTab === tab.id ? Y : W30, borderColor: activeTab === tab.id ? Y : 'transparent' }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── CONTACTS TAB ── */}
        {activeTab === 'contacts' && (
          <div>
            {contacts.length === 0 && !artist.general_manager ? (
              <div className="text-center py-16" style={{ color: W30 }}>
                <div className="text-4xl mb-3 opacity-30">📋</div>
                <div className="text-sm mb-1">No contact data yet.</div>
                <div className="text-xs" style={{ color: W30 }}>
                  Contacts are pulled from Monday.com fields. Run the Monday sync to populate, or add manually.
                </div>
              </div>
            ) : (
              <div>
                {contacts.length === 0 && artist.general_manager && (
                  <div className="rounded-xl p-4 border mb-4" style={{ background: SURFACE, borderColor: BORDER }}>
                    <div className="text-xs uppercase tracking-wider mb-2" style={{ color: W30 }}>General Manager</div>
                    <div className="text-base font-semibold text-white">{artist.general_manager}</div>
                    <span className="inline-block text-xs uppercase tracking-wider mt-2 px-2 py-0.5 rounded"
                      style={{ background: BORDER, color: W30 }}>Chartmetric</span>
                  </div>
                )}
                {managers.length > 0 && (
                  <div className="mb-6">
                    <div className="text-xs uppercase tracking-wider mb-3" style={{ color: W50 }}>Management</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {managers.map(c => <ContactCard key={c.id} contact={c} onCopy={handleCopy} />)}
                    </div>
                  </div>
                )}
                {agents.length > 0 && (
                  <div className="mb-6">
                    <div className="text-xs uppercase tracking-wider mb-3" style={{ color: W50 }}>Agency</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {agents.map(c => <ContactCard key={c.id} contact={c} onCopy={handleCopy} />)}
                    </div>
                  </div>
                )}
                {bizManagers.length > 0 && (
                  <div className="mb-6">
                    <div className="text-xs uppercase tracking-wider mb-3" style={{ color: W50 }}>Business Management</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {bizManagers.map(c => <ContactCard key={c.id} contact={c} onCopy={handleCopy} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── INTELLIGENCE TAB ── */}
        {activeTab === 'intelligence' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider mb-4" style={{ color: W50 }}>Audience Demographics</div>
              <div className="rounded-xl p-4 border mb-4" style={{ background: SURFACE, borderColor: BORDER }}>
                <div className="text-xs uppercase tracking-wider mb-3" style={{ color: W30 }}>Age & Gender</div>
                <ButterflyChart artist={artist} />
              </div>
              {ethnicityRows.length > 0 && (
                <div className="rounded-xl p-4 border mb-4" style={{ background: SURFACE, borderColor: BORDER }}>
                  <div className="text-xs uppercase tracking-wider mb-3" style={{ color: W30 }}>Ethnicity</div>
                  {ethnicityRows.map(row => (
                    <div key={row.label} className="flex items-center gap-3 mb-2">
                      <div className="text-xs w-36 shrink-0" style={{ color: W50 }}>{row.label}</div>
                      <div className="flex-1 h-1.5 rounded overflow-hidden" style={{ background: BORDER }}>
                        <div className="h-full rounded" style={{ width: `${row.value}%`, background: Y }} />
                      </div>
                      <div className="text-xs w-8 text-right font-mono" style={{ color: W30 }}>{formatPct(row.value)}</div>
                    </div>
                  ))}
                </div>
              )}
              {artist.top_countries && artist.top_countries.length > 0 && (
                <div className="rounded-xl p-4 border" style={{ background: SURFACE, borderColor: BORDER }}>
                  <div className="text-xs uppercase tracking-wider mb-3" style={{ color: W30 }}>Top Markets</div>
                  {artist.top_countries.slice(0, 5).map((c, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: BORDER }}>
                      <span className="text-xl leading-none">{countryFlag(c.code)}</span>
                      <span className="flex-1 text-sm" style={{ color: W80 }}>{c.country}</span>
                      <span className="text-sm font-mono" style={{ color: W50 }}>{formatPct(c.pct)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider mb-4" style={{ color: W50 }}>Brand Intelligence</div>
              <div className="flex gap-4 border-b mb-4" style={{ borderColor: BORDER }}>
                {(['brands', 'sectors'] as const).map(t => (
                  <button key={t} onClick={() => setIntelTab(t)}
                    className="pb-2 text-xs font-semibold tracking-widest uppercase border-b-2 -mb-px transition-colors"
                    style={{ color: intelTab === t ? Y : W30, borderColor: intelTab === t ? Y : 'transparent' }}>
                    {t === 'brands' ? 'Brand Affinities' : 'Sector Interests'}
                  </button>
                ))}
              </div>
              <div className="rounded-xl p-4 border" style={{ background: SURFACE, borderColor: BORDER }}>
                <div className="overflow-y-auto" style={{ maxHeight: '520px' }}>
                  {intelTab === 'brands'
                    ? (brands.length > 0 ? <AffinityTable items={brands} labelKey="brand_name" valueKey="affinity_scale" /> : <p className="text-sm py-4" style={{ color: W30 }}>No brand affinity data.</p>)
                    : (sectors.length > 0 ? <AffinityTable items={sectors} labelKey="sector_name" valueKey="affinity_scale" /> : <p className="text-sm py-4" style={{ color: W30 }}>No sector data.</p>)
                  }
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ACTIVITY TAB ── */}
        {activeTab === 'activity' && (
          <div>
            {activity.length === 0 ? (
              <div className="text-center py-16" style={{ color: W30 }}>
                <div className="text-4xl mb-3 opacity-30">📡</div>
                <div className="text-sm font-medium mb-1" style={{ color: W50 }}>No activity signals yet</div>
                <div className="text-xs max-w-xs mx-auto">
                  Activity populates automatically when festival bookings are detected, streaming spikes occur, or deal stages change. This requires the festival monitor pipeline (Phase 2).
                </div>
              </div>
            ) : (
              <div>
                <div className="text-xs uppercase tracking-wider mb-4" style={{ color: W50 }}>Activity Timeline</div>
                {activity.map((entry, i) => {
                  const cfg = EVENT_TYPE_CONFIG[entry.event_type] ?? { color: W50, icon: '•' }
                  return (
                    <div key={entry.id} className="flex gap-4 pb-5 relative">
                      {i < activity.length - 1 && (
                        <div className="absolute left-3.5 top-6 bottom-0 w-px" style={{ background: BORDER }} />
                      )}
                      <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center border-2 mt-0.5 z-10 text-sm"
                        style={{ background: BG, borderColor: cfg.color }}>
                        {cfg.icon}
                      </div>
                      <div className="flex-1 rounded-xl p-3 border" style={{ background: SURFACE, borderColor: BORDER }}>
                        <div className="font-semibold text-sm text-white mb-0.5">{entry.event_title}</div>
                        <div className="text-xs flex gap-3 flex-wrap" style={{ color: W50 }}>
                          {entry.created_at && <span>Detected {formatDateFull(entry.created_at)}</span>}
                          {entry.event_date && <span>Event {formatDateFull(entry.event_date)}</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── PITCH BUILDER TAB ── */}
        {activeTab === 'pitch' && (
          <div>
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: W50 }}>AI Pitch Builder</div>
            <div className="text-sm mb-5" style={{ color: W30 }}>
              Describe what you need — VIP sales pitch, brand partnership outreach, cold email — and Claude will build it using {artist.name}'s audience data, brand affinities, and tour context.
            </div>
            <div className="rounded-xl p-3 border mb-5 text-xs" style={{ background: SURFACE, borderColor: BORDER, color: W30 }}>
              ℹ️ Pitches are written as P&TY representatives. Projected gross revenue is never included. Brand partnership claims are carefully qualified.
            </div>
            <div className="flex gap-2 mb-6">
              <input
                value={pitchInput}
                onChange={e => setPitchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGeneratePitch()}
                placeholder={`Build a VIP pitch for ${artist.name} targeting millennials...`}
                className="flex-1 px-4 py-3 rounded-xl border text-sm outline-none"
                style={{ background: SURFACE2, borderColor: BORDER, color: '#fff' }}
              />
              <button onClick={handleGeneratePitch} disabled={pitchLoading || !pitchInput.trim()}
                className="px-5 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                style={{ background: Y, color: BG }}>
                {pitchLoading ? 'Generating…' : 'Generate'}
              </button>
            </div>
            {pitchLoading && (
              <div className="flex items-center gap-3 py-8" style={{ color: W30 }}>
                <Spinner /><span className="text-sm">Building pitch…</span>
              </div>
            )}
            {pitchOutput && !pitchLoading && (
              <div className="rounded-xl border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xs uppercase tracking-wider" style={{ color: W30 }}>Generated Pitch</div>
                  <button onClick={() => handleCopy(pitchOutput)}
                    className="text-xs px-3 py-1.5 rounded-lg border"
                    style={{ borderColor: BORDER, color: W50 }}>Copy</button>
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: W80 }}>{pitchOutput}</div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
