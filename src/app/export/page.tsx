'use client'

import { useState, useEffect } from 'react'

const Y = '#F9D40A'
const BG = '#0f0f0f'
const SURFACE = '#141414'
const SURFACE2 = '#1C1C1C'
const BORDER = 'rgba(255,255,255,0.08)'
const W80 = 'rgba(255,255,255,0.8)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'

interface StatsData {
  total_contacts: number
  total_artists: number
}

interface PlatformOption {
  key: string
  label: string
  description: string
}

const PLATFORMS: PlatformOption[] = [
  { key: 'google_ads', label: 'Google Ads Customer Match', description: 'Email, Phone, Name, Country, Zip' },
  { key: 'meta', label: 'Meta Custom Audiences', description: 'Lowercase format with all demographics' },
  { key: 'linkedin', label: 'LinkedIn Matched Audiences', description: 'Email, Name, Company, Job Title' },
  { key: 'tiktok', label: 'TikTok Ads', description: 'Email + Phone columns with MAID' },
  { key: 'raw', label: 'Raw CSV (All Fields)', description: 'Complete data export with artist names' },
]

const STAGES = [
  'Outbound - No Contact',
  'Outbound - Automated Contact',
  'Prospect - Direct Sales Agent Contact',
  'Active Leads (Contact Has Responded)',
  'Proposal (financials submitted)',
  'Negotiation (Terms Being Discussed)',
  'Finalizing On-Sale (Terms Agreed)',
  'Won (Final On-Sale Planned)',
]

const ROLES = [
  { key: 'manager', label: 'Manager' },
  { key: 'agent', label: 'Agent' },
  { key: 'business_manager', label: 'Business Manager' },
]

function DownloadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 3v10m0 0l-3.5-3.5M10 13l3.5-3.5M3 15v1a2 2 0 002 2h10a2 2 0 002-2v-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function ExportPage() {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [stage, setStage] = useState('')
  const [role, setRole] = useState('')

  useEffect(() => {
    fetch('/api/admin/export-contacts')
      .then((res) => res.json())
      .then((data) => {
        setStats(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleDownload(platform: string) {
    setDownloading(platform)
    try {
      const params = new URLSearchParams({ platform })
      if (stage) params.set('stage', stage)
      if (role) params.set('role', role)

      const res = await fetch(`/api/admin/export-contacts?${params}`)
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Download failed')
        return
      }

      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const filenameMatch = disposition.match(/filename="(.+)"/)
      const filename = filenameMatch ? filenameMatch[1] : `pty_contacts_${platform}.csv`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      alert('Download failed. Please try again.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: BG,
        color: W80,
        padding: '32px 24px',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: W80, marginBottom: 6 }}>
            Contact Export
          </h1>
          <p style={{ fontSize: 14, color: W50 }}>
            Download contacts formatted for ad platform upload
          </p>
        </div>

        {/* Stats bar */}
        <div
          style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 24,
            display: 'flex',
            gap: 32,
          }}
        >
          {loading ? (
            <span style={{ fontSize: 13, color: W30 }}>Loading stats...</span>
          ) : stats ? (
            <>
              <div>
                <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: Y }}>
                  {stats.total_contacts.toLocaleString()}
                </span>
                <span style={{ fontSize: 13, color: W50, marginLeft: 8 }}>contacts</span>
              </div>
              <div>
                <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: Y }}>
                  {stats.total_artists.toLocaleString()}
                </span>
                <span style={{ fontSize: 13, color: W50, marginLeft: 8 }}>artists</span>
              </div>
            </>
          ) : (
            <span style={{ fontSize: 13, color: W30 }}>Failed to load stats</span>
          )}
        </div>

        {/* Filters */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginBottom: 24,
            flexWrap: 'wrap',
          }}
        >
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            style={{
              background: SURFACE2,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: '8px 12px',
              color: W80,
              fontSize: 13,
              flex: 1,
              minWidth: 200,
              cursor: 'pointer',
            }}
          >
            <option value="">All Stages (excl. Lost)</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{
              background: SURFACE2,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: '8px 12px',
              color: W80,
              fontSize: 13,
              minWidth: 160,
              cursor: 'pointer',
            }}
          >
            <option value="">All Roles</option>
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {/* Download buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {PLATFORMS.map((p) => {
            const isDownloading = downloading === p.key
            return (
              <button
                key={p.key}
                onClick={() => handleDownload(p.key)}
                disabled={isDownloading}
                style={{
                  background: SURFACE,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: isDownloading ? 'wait' : 'pointer',
                  opacity: isDownloading ? 0.6 : 1,
                  transition: 'all 200ms ease',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isDownloading) {
                    e.currentTarget.style.borderColor = Y
                    e.currentTarget.style.background = SURFACE2
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = BORDER
                  e.currentTarget.style.background = SURFACE
                }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: W80, marginBottom: 3 }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: 12, color: W30 }}>{p.description}</div>
                </div>
                <div
                  style={{
                    color: isDownloading ? W30 : Y,
                    flexShrink: 0,
                    marginLeft: 16,
                  }}
                >
                  {isDownloading ? (
                    <span style={{ fontSize: 13 }}>Downloading...</span>
                  ) : (
                    <DownloadIcon />
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer note */}
        <p style={{ fontSize: 12, color: W30, marginTop: 24, textAlign: 'center' }}>
          Exports exclude contacts from Lost-stage artists. Contacts without email are excluded from platform exports (except TikTok with phone).
        </p>
      </div>
    </div>
  )
}
