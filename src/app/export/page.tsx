'use client'

import { useState, useEffect, useCallback } from 'react'

const Y = '#F9D40A'
const BG = '#0f0f0f'
const SURFACE = '#141414'
const SURFACE2 = '#1C1C1C'
const BORDER = 'rgba(255,255,255,0.08)'
const W80 = 'rgba(255,255,255,0.8)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'

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
  { key: 'raw', label: 'Raw CSV (All Fields)', description: 'Complete data export' },
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

function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 3v4.5h4.5M16.5 15v-4.5H12M2.25 11.25a6.75 6.75 0 0111.4-3.37L16.5 10.5M1.5 7.5l2.85 2.62a6.75 6.75 0 0011.4-3.37"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function ExportPage() {
  const [totalContacts, setTotalContacts] = useState<number | null>(null)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)

  const fetchStats = useCallback(() => {
    fetch('/api/admin/export-contacts')
      .then((res) => res.json())
      .then((data) => {
        setTotalContacts(data.total_contacts ?? null)
        setLastSynced(data.last_synced ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  async function handleSync() {
    setSyncing(true)
    setSyncStatus('Pulling contacts from Monday CRM...')
    try {
      const res = await fetch('/api/admin/sync-export-contacts', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        setSyncStatus(`Sync failed: ${err.error || 'Unknown error'}`)
        return
      }
      const data = await res.json()
      setSyncStatus(`Synced ${data.synced.toLocaleString()} contacts`)
      fetchStats()
      setTimeout(() => setSyncStatus(''), 4000)
    } catch {
      setSyncStatus('Sync failed. Please try again.')
    } finally {
      setSyncing(false)
    }
  }

  async function handleDownload(platform: string) {
    setDownloading(platform)
    try {
      const res = await fetch(`/api/admin/export-contacts?platform=${platform}`)
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
    <div style={{ minHeight: '100vh', background: BG, color: W80, padding: '32px 24px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: W80, marginBottom: 6 }}>
            Contact Export
          </h1>
          <p style={{ fontSize: 14, color: W50 }}>
            Download CRM contacts formatted for ad platform upload
          </p>
        </div>

        {/* Stats bar */}
        <div
          style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            {loading ? (
              <span style={{ fontSize: 13, color: W30 }}>Loading...</span>
            ) : totalContacts !== null ? (
              <>
                <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: Y }}>
                  {totalContacts.toLocaleString()}
                </span>
                <span style={{ fontSize: 13, color: W50, marginLeft: 8 }}>contacts</span>
                {lastSynced && (
                  <div style={{ fontSize: 11, color: W30, marginTop: 4 }}>
                    Last synced {formatTimestamp(lastSynced)}
                  </div>
                )}
              </>
            ) : (
              <span style={{ fontSize: 13, color: W30 }}>No contacts synced yet</span>
            )}
          </div>
        </div>

        {/* Refresh button */}
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            width: '100%',
            background: syncing ? SURFACE : Y,
            color: syncing ? W50 : BG,
            border: 'none',
            borderRadius: 12,
            padding: '14px 20px',
            fontSize: 14,
            fontWeight: 700,
            cursor: syncing ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 24,
            transition: 'all 200ms ease',
            opacity: syncing ? 0.7 : 1,
          }}
        >
          <span style={{ display: 'flex', animation: syncing ? 'spin 1s linear infinite' : 'none' }}>
            <RefreshIcon />
          </span>
          {syncing ? 'Syncing...' : 'Refresh from Monday CRM'}
        </button>

        {/* Sync status message */}
        {syncStatus && (
          <div
            style={{
              fontSize: 13,
              color: syncStatus.includes('failed') ? '#FF4444' : '#00D26A',
              textAlign: 'center',
              marginTop: -16,
              marginBottom: 16,
            }}
          >
            {syncStatus}
          </div>
        )}

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
                <div style={{ color: isDownloading ? W30 : Y, flexShrink: 0, marginLeft: 16 }}>
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
          Pulls all contacts from the Monday CRM board. Invalid emails and suspicious cell content are
          stripped automatically. Platform exports require a valid email (except TikTok which accepts phone-only).
        </p>

        {/* CSS for spin animation */}
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )
}
