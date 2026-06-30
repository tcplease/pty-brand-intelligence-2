'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const Y = '#F9D40A'
const BG = '#0f0f0f'
const SURFACE = '#141414'
const SURFACE2 = '#1C1C1C'
const BORDER = 'rgba(255,255,255,0.08)'
const W80 = 'rgba(255,255,255,0.8)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'
const GREEN = '#00D26A'

interface FlaggedItem {
  name: string
  deals: { monday_item_id: number; stage: string }[]
}
interface Candidate {
  id: number
  name: string
  cm_score: number | null
  followers: number
  existsInDb: boolean
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export default function ReviewPage() {
  const [items, setItems] = useState<FlaggedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [search, setSearch] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/review')
    const json = await res.json()
    setItems(json.items ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const findMatches = useCallback(async (name: string) => {
    setBusy(`search:${name}`)
    const res = await fetch('/api/admin/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'candidates', name: search[name] ?? name }),
    })
    const json = await res.json()
    setCandidates((prev) => ({ ...prev, [name]: json.candidates ?? [] }))
    setBusy(null)
  }, [search])

  const link = useCallback(async (item: FlaggedItem, cand: Candidate) => {
    if (!window.confirm(`Link "${item.name}" → ${cand.name} (CM ${cand.id})?`)) return
    setBusy(`link:${item.name}`)
    const res = await fetch('/api/admin/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'link',
        name: item.name,
        monday_item_ids: item.deals.map((d) => d.monday_item_id),
        chartmetric_id: cand.id,
        cm_name: cand.name,
      }),
    })
    const json = await res.json()
    setBusy(null)
    if (json.success) {
      setItems((prev) => prev.filter((i) => i.name !== item.name))
    } else {
      window.alert(`Link failed: ${json.error}`)
    }
  }, [])

  return (
    <div className="min-h-screen" style={{ background: BG, fontFamily: 'system-ui, sans-serif' }}>
      {/* Main nav */}
      <nav className="flex items-center gap-4 px-4 md:px-6 py-3 border-b sticky top-0 z-50" style={{ background: BG, borderColor: BORDER }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pty-logo.svg" alt="P&TY" className="h-9 w-auto shrink-0" />
        <div className="h-4 w-px shrink-0" style={{ backgroundColor: BORDER }} />
        <Link href="/" className="text-sm py-3 px-3 block transition-colors hover:text-white" style={{ color: W50 }}>Pipeline</Link>
        <Link href="/radar" className="text-sm py-3 px-3 block transition-colors hover:text-white" style={{ color: W50 }}>Radar</Link>
        <Link href="/match" className="text-sm py-3 px-3 block transition-colors hover:text-white" style={{ color: W50 }}>Match</Link>
        <Link href="/live" className="text-sm py-3 px-3 block transition-colors hover:text-white" style={{ color: W50 }}>Live</Link>
        <Link href="/merch" className="text-sm py-3 px-3 block transition-colors hover:text-white" style={{ color: W50 }}>Merch</Link>
        <span className="ml-auto text-xs uppercase tracking-wider" style={{ color: Y }}>Needs Review</span>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold mb-1" style={{ color: W80 }}>Needs-Review Queue</h1>
        <p className="text-sm mb-6" style={{ color: W50 }}>
          Deals the resolver couldn&apos;t confidently auto-link (generic name, &amp;-split, low-similarity match).
          Find the right artist and link it — writes only our DB, never Monday.
        </p>

        {loading ? (
          <p style={{ color: W30 }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ color: GREEN }}>✓ Queue empty — nothing awaiting review.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <div key={item.name} className="rounded-xl p-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-base font-semibold" style={{ color: W80 }}>{item.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: W50 }}>
                      {item.deals.length} deal{item.deals.length === 1 ? '' : 's'} · {[...new Set(item.deals.map((d) => d.stage))].join(', ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="search CM by name…"
                      defaultValue={item.name}
                      onChange={(e) => setSearch((p) => ({ ...p, [item.name]: e.target.value }))}
                      className="px-3 py-2 rounded-lg text-sm"
                      style={{ background: SURFACE2, color: W80, border: `1px solid ${BORDER}`, width: 200 }}
                    />
                    <button
                      onClick={() => findMatches(item.name)}
                      disabled={busy === `search:${item.name}`}
                      className="px-3 py-2 rounded-lg text-sm font-semibold"
                      style={{ background: Y, color: BG }}
                    >
                      {busy === `search:${item.name}` ? '…' : 'Find matches'}
                    </button>
                  </div>
                </div>

                {candidates[item.name] && (
                  <div className="mt-3 flex flex-col gap-2">
                    {candidates[item.name].length === 0 ? (
                      <p className="text-xs" style={{ color: W30 }}>No Chartmetric candidates.</p>
                    ) : (
                      candidates[item.name].map((cand) => (
                        <div key={cand.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: SURFACE2 }}>
                          <div className="min-w-0">
                            <div className="text-sm truncate" style={{ color: W80 }}>
                              {cand.name}
                              {cand.existsInDb && <span className="ml-2 text-xs" style={{ color: GREEN }}>in DB</span>}
                            </div>
                            <div className="text-xs font-mono" style={{ color: W50 }}>
                              CM {cand.id} · {fmt(cand.followers)} followers · score {cand.cm_score ?? '—'}
                            </div>
                          </div>
                          <button
                            onClick={() => link(item, cand)}
                            disabled={busy === `link:${item.name}`}
                            className="px-3 py-1.5 rounded-lg text-sm font-semibold shrink-0"
                            style={{ background: GREEN, color: BG }}
                          >
                            {busy === `link:${item.name}` ? '…' : 'Link'}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
