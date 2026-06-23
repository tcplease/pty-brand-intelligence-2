'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { groupByCountryThenCity } from '@/lib/live-query'

// ── Constants (Match Report aesthetic: Stage Black + Electric Yellow) ──
const BG = '#0f0f0f'
const SURFACE = '#141414'
const SURFACE2 = '#1C1C1C'
const SURFACE3 = '#242424'
const BORDER = 'rgba(255,255,255,0.08)'
const Y = '#F9D40A'
const W80 = 'rgba(255,255,255,0.8)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'

const CAREER_COLORS: Record<string, string> = {
  legendary: '#ef4444',
  superstar: '#f97316',
  mainstream: '#F9D40A',
  'mid-level': '#00D26A',
  developing: '#4A9EFF',
  undiscovered: 'rgba(255,255,255,0.3)',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ── Types ──
interface ArtistInfo {
  name: string
  image_url: string | null
  career_stage: string | null
}

interface ResultRow {
  id: number
  monday_item_id: number
  artist_name: string
  chartmetric_id: number | null
  match_status: string
  show_date: string | null
  venue_name: string | null
  city: string | null
  state: string | null
  country: string | null
  full_address: string | null
  artist: ArtistInfo | null
}

type Step = 'date' | 'country' | 'state' | 'city' | 'results'
type GroupMode = 'city' | 'artist'

interface InitialState {
  start: string
  end: string
  countries: string[]
  states: string[]
  cities: string[]
  group: GroupMode
}

// ── Helpers ──
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function plusDaysISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// Parse 'YYYY-MM-DD' without timezone drift.
function fmtDate(s: string | null): string {
  if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return s
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

function mapsHref(r: ResultRow): string {
  const query =
    r.full_address ?? [r.venue_name, r.city, r.state, r.country].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

// Stable key per artist/event. Unmatched (no profile) keyed by name → event card.
function artistKey(r: ResultRow): string {
  return r.chartmetric_id != null ? `cm:${r.chartmetric_id}` : `ev:${r.artist_name}`
}

function cityLabel(r: ResultRow): string {
  const city = r.city ?? 'Unknown city'
  return r.state ? `${city}, ${r.state}` : city
}

// Repeated query params for an array (countries=US&countries=CA).
function arrParams(name: string, arr: string[]): string {
  return arr.map((v) => `${name}=${encodeURIComponent(v)}`).join('&')
}

// ── Small UI bits ──
function EventIcon() {
  // Generic event/ticket glyph used in place of an artist photo for EVENT cards.
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke={W50} strokeWidth="1.5">
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" />
      <path d="M15 6v12" strokeDasharray="2 2" />
    </svg>
  )
}

function PlaceholderArtist() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke={W30} strokeWidth="1.5">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </svg>
  )
}

function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  )
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke={BG} strokeWidth="3">
      <path d="M5 12l5 5L20 6" />
    </svg>
  )
}

// ── Card ──
interface CardGroup {
  key: string
  name: string
  image: string | null
  career: string | null
  isEvent: boolean
  shows: ResultRow[]
}

// One card per artist/event from a flat row list, sorted by name. Shared by both
// grouping modes (by-artist directly; by-city via groupByCountryThenCity).
function buildCardGroups(rows: ResultRow[]): CardGroup[] {
  const map = new Map<string, CardGroup>()
  for (const r of rows) {
    const key = artistKey(r)
    let g = map.get(key)
    if (!g) {
      g = {
        key,
        name: r.artist?.name ?? r.artist_name,
        image: r.artist?.image_url ?? null,
        career: r.artist?.career_stage ?? null,
        isEvent: r.chartmetric_id == null,
        shows: [],
      }
      map.set(key, g)
    }
    g.shows.push(r)
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function ArtistCard({
  group,
  onRemoveShow,
  onRemoveArtist,
}: {
  group: CardGroup
  onRemoveShow: (mondayItemId: number) => void
  onRemoveArtist: (key: string) => void
}) {
  const careerColor = group.career ? CAREER_COLORS[group.career.toLowerCase()] ?? W50 : W50

  return (
    <div className="rounded-xl p-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
      <div className="flex items-start gap-3">
        {/* Image / icon */}
        <div
          className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center overflow-hidden"
          style={{ background: SURFACE3 }}
        >
          {group.isEvent ? (
            <EventIcon />
          ) : group.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.image} alt={group.name} className="w-full h-full object-cover" />
          ) : (
            <PlaceholderArtist />
          )}
        </div>

        {/* Name + badge */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold truncate" style={{ color: W80 }}>
              {group.name}
            </h3>
            <button
              onClick={() => onRemoveArtist(group.key)}
              className="shrink-0 p-2 rounded-md transition-colors"
              style={{ color: W30 }}
              aria-label="Remove artist"
              title="Remove artist"
            >
              <TrashIcon size={16} />
            </button>
          </div>
          <div className="mt-1">
            {group.isEvent ? (
              <span
                className="inline-block text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                style={{ background: SURFACE3, color: W50 }}
              >
                Event
              </span>
            ) : group.career ? (
              <span
                className="inline-block text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                style={{ background: 'rgba(255,255,255,0.04)', color: careerColor, border: `1px solid ${careerColor}` }}
              >
                {group.career.toUpperCase()}
              </span>
            ) : (
              <span
                className="inline-block text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                style={{ background: SURFACE3, color: W30 }}
              >
                —
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Show list */}
      <div className="mt-3 flex flex-col gap-1.5">
        {group.shows.map((s) => (
          <div
            key={s.monday_item_id}
            className="flex items-center gap-2 text-sm rounded-lg px-3 py-2"
            style={{ background: SURFACE2, color: W80 }}
          >
            <span className="flex-1 min-w-0 truncate">
              <span className="font-mono" style={{ color: Y }}>
                {fmtDate(s.show_date)}
              </span>
              <span style={{ color: W30 }}> | </span>
              <span>{cityLabel(s)}</span>
              <span style={{ color: W30 }}> | </span>
              <span style={{ color: W50 }}>{s.venue_name ?? '—'}</span>
            </span>
            <a
              href={mapsHref(s)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs underline"
              style={{ color: W50 }}
            >
              Map
            </a>
            <button
              onClick={() => onRemoveShow(s.monday_item_id)}
              className="shrink-0 p-1.5 rounded-md transition-colors"
              style={{ color: W30 }}
              aria-label="Remove show"
              title="Remove show"
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Multi-select checkbox step ──
function CheckboxStep({
  title,
  options,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
  onSubmit,
  submitLabel,
  loading,
  emptyMsg,
}: {
  title: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  onSelectAll: () => void
  onClearAll: () => void
  onSubmit: () => void
  submitLabel: string
  loading: boolean
  emptyMsg: string
}) {
  const selectedSet = new Set(selected)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm uppercase tracking-wider" style={{ color: W50 }}>
          {title}
        </h2>
        {!loading && options.length > 0 && (
          <div className="flex gap-2 text-xs uppercase tracking-wider">
            <button onClick={onSelectAll} style={{ color: Y }} className="px-2 py-1">
              Select all
            </button>
            <button onClick={onClearAll} style={{ color: W50 }} className="px-2 py-1">
              Clear all
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p style={{ color: W30 }}>Loading…</p>
      ) : options.length === 0 ? (
        <p style={{ color: W30 }}>{emptyMsg}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {options.map((opt) => {
              const on = selectedSet.has(opt)
              return (
                <button
                  key={opt}
                  onClick={() => onToggle(opt)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{
                    background: on ? 'rgba(249,212,10,0.10)' : SURFACE2,
                    color: on ? Y : W80,
                    border: `1px solid ${on ? Y : BORDER}`,
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  <span
                    className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                    style={{ background: on ? Y : 'transparent', border: `1px solid ${on ? Y : W30}` }}
                  >
                    {on && <CheckMark />}
                  </span>
                  {opt}
                </button>
              )
            })}
          </div>
          <button
            onClick={onSubmit}
            disabled={selected.length === 0}
            className="self-start px-5 py-3 rounded-lg font-bold uppercase tracking-wider text-sm transition-colors"
            style={{
              background: selected.length === 0 ? SURFACE3 : Y,
              color: selected.length === 0 ? W30 : BG,
              cursor: selected.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {submitLabel} ({selected.length})
          </button>
        </>
      )}
    </div>
  )
}

// ── Main ──
export default function LiveClient({ initial }: { initial: InitialState }) {
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [step, setStep] = useState<Step>('date')

  const [countries, setCountries] = useState<string[]>([])
  const [countrySel, setCountrySel] = useState<string[]>(initial.countries)
  const [states, setStates] = useState<string[]>([])
  const [stateSel, setStateSel] = useState<string[]>(initial.states)
  const [cities, setCities] = useState<string[]>([])
  const [citySel, setCitySel] = useState<string[]>(initial.cities)

  const [results, setResults] = useState<ResultRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [group, setGroup] = useState<GroupMode>(initial.group)
  const [removedShows, setRemovedShows] = useState<Set<number>>(new Set())
  const [removedArtists, setRemovedArtists] = useState<Set<string>>(new Set())
  const [clientName, setClientName] = useState('')

  // ── Fetch helper ──
  const fetchJson = useCallback(async (qs: string): Promise<Record<string, unknown> | null> => {
    setError('')
    try {
      const res = await fetch(`/api/live?${qs}`)
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Request failed')
        return null
      }
      return json
    } catch {
      setError('Network error')
      return null
    }
  }, [])

  // ── Step loaders ──
  const loadCountries = useCallback(async () => {
    setLoading(true)
    const json = await fetchJson(`mode=countries&start=${start}&end=${end}`)
    setLoading(false)
    if (json) {
      const list = (json.countries as string[]) ?? []
      setCountries(list)
      // US pre-checked when present (and no prior selection hydrated).
      setCountrySel((prev) => (prev.length > 0 ? prev : list.includes('US') ? ['US'] : []))
    }
  }, [fetchJson, start, end])

  const loadResults = useCallback(
    async (c: string[], st: string[], ci: string[]) => {
      setLoading(true)
      const qs = [
        `mode=results&start=${start}&end=${end}`,
        arrParams('countries', c),
        arrParams('states', st),
        arrParams('cities', ci),
      ]
        .filter(Boolean)
        .join('&')
      const json = await fetchJson(qs)
      setLoading(false)
      if (json) {
        setResults((json.results as ResultRow[]) ?? [])
        setStep('results')
      }
    },
    [fetchJson, start, end],
  )

  const loadCities = useCallback(
    async (c: string[], st: string[]) => {
      setLoading(true)
      const qs = [
        `mode=cities&start=${start}&end=${end}`,
        arrParams('countries', c),
        arrParams('states', st),
      ]
        .filter(Boolean)
        .join('&')
      const json = await fetchJson(qs)
      setLoading(false)
      if (json) {
        setCities((json.cities as string[]) ?? [])
        setStep('city')
      }
    },
    [fetchJson, start, end],
  )

  // Country → state (if any selected country has states) else straight to cities.
  const loadStates = useCallback(
    async (c: string[]) => {
      setLoading(true)
      const qs = [`mode=states&start=${start}&end=${end}`, arrParams('countries', c)].join('&')
      const json = await fetchJson(qs)
      const list = ((json?.states as string[]) ?? []) as string[]
      setStates(list)
      setLoading(false)
      if (list.length > 0) {
        setStep('state')
      } else {
        // None of the selected countries have states in range → skip to cities.
        setStateSel([])
        await loadCities(c, [])
      }
    },
    [fetchJson, start, end, loadCities],
  )

  // ── Toggle helpers ──
  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))

  // ── Handlers ──
  const confirmDates = useCallback(() => {
    if (!start || !end) {
      setError('Pick a start and end date')
      return
    }
    if (start > end) {
      setError('Start date must be on or before end date')
      return
    }
    setStep('country')
    void loadCountries()
  }, [start, end, loadCountries])

  const submitCountries = useCallback(() => {
    if (countrySel.length === 0) {
      setError('Select at least one country')
      return
    }
    setStateSel([])
    setCitySel([])
    void loadStates(countrySel)
  }, [countrySel, loadStates])

  const submitStates = useCallback(() => {
    if (stateSel.length === 0) {
      setError('Select at least one state')
      return
    }
    setCitySel([])
    void loadCities(countrySel, stateSel)
  }, [stateSel, countrySel, loadCities])

  const submitCities = useCallback(() => {
    if (citySel.length === 0) {
      setError('Select at least one city')
      return
    }
    void loadResults(countrySel, stateSel, citySel)
  }, [citySel, countrySel, stateSel, loadResults])

  // Open the print-ready PDF in a new tab. Encodes the full selection + the curation
  // deltas (removed shows / removed cards) so the export route re-runs the identical
  // query and subtracts exactly what was trashed on screen — PDF == curated screen.
  const exportPdf = useCallback(() => {
    const params = new URLSearchParams()
    params.set('start', start)
    params.set('end', end)
    countrySel.forEach((c) => params.append('countries', c))
    stateSel.forEach((s) => params.append('states', s))
    citySel.forEach((c) => params.append('cities', c))
    params.set('group', group)
    if (clientName.trim()) params.set('client', clientName.trim())
    removedShows.forEach((id) => params.append('rmShow', String(id)))
    removedArtists.forEach((k) => params.append('rmCard', k))
    window.open(`/api/live/report?${params.toString()}`, '_blank')
  }, [start, end, countrySel, stateSel, citySel, group, clientName, removedShows, removedArtists])

  const removeShow = useCallback((mondayItemId: number) => {
    if (!window.confirm('Remove this show?')) return
    setRemovedShows((prev) => new Set(prev).add(mondayItemId))
  }, [])

  const removeArtist = useCallback((key: string) => {
    if (!window.confirm('Remove artist?')) return
    setRemovedArtists((prev) => new Set(prev).add(key))
  }, [])

  const resetAll = useCallback(() => {
    setStep('date')
    setCountrySel([])
    setStateSel([])
    setCitySel([])
    setResults(null)
    setRemovedShows(new Set())
    setRemovedArtists(new Set())
    setError('')
  }, [])

  // ── Hydration (Next 16 query-param arrays → state) ──
  useEffect(() => {
    if (!start) setStart(todayISO())
    if (!end) setEnd(plusDaysISO(365))
    // A full path arrived via query params → fast-forward to results.
    if (initial.start && initial.end && initial.countries.length > 0) {
      void loadResults(initial.countries, initial.states, initial.cities)
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Derived: visible rows + grouping ──
  const visible = useMemo(() => {
    if (!results) return []
    return results.filter(
      (r) => !removedShows.has(r.monday_item_id) && !removedArtists.has(artistKey(r)),
    )
  }, [results, removedShows, removedArtists])

  const byArtist = useMemo(() => buildCardGroups(visible), [visible])

  // Two-level: country band → cities within → cards. Shares the grouping/order/labeling
  // with the PDF export (groupByCountryThenCity) so screen and PDF stay identical.
  const byCity = useMemo(
    () => groupByCountryThenCity(visible, countrySel, buildCardGroups),
    [visible, countrySel],
  )

  // ── Render ──
  const pathCrumb = [
    start && end ? `${start} → ${end}` : null,
    countrySel.length ? countrySel.join(', ') : null,
    stateSel.length ? stateSel.join(', ') : null,
    citySel.length ? `${citySel.length} cit${citySel.length === 1 ? 'y' : 'ies'}` : null,
  ]
    .filter(Boolean)
    .join('  ›  ')

  return (
    <div className="min-h-screen" style={{ background: BG }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3"
        style={{ background: BG, borderBottom: `1px solid ${BORDER}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pty-logo.svg" alt="P&TY" className="h-8 w-auto" />
        <h1 className="text-lg font-bold tracking-wider uppercase" style={{ color: Y }}>
          Live Shows
        </h1>
        {step !== 'date' && (
          <button
            onClick={resetAll}
            className="ml-auto text-xs uppercase tracking-wider px-3 py-2 rounded-lg transition-colors"
            style={{ color: W50, border: `1px solid ${BORDER}` }}
          >
            Start over
          </button>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {pathCrumb && (
          <p className="text-xs mb-4" style={{ color: W50 }}>
            {pathCrumb}
          </p>
        )}

        {error && (
          <p className="text-sm mb-4" style={{ color: '#FF4444' }}>
            {error}
          </p>
        )}

        {/* Step: date range */}
        {step === 'date' && (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm uppercase tracking-wider" style={{ color: W50 }}>
              Select date range
            </h2>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-xs" style={{ color: W50 }}>
                Start
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{ background: SURFACE2, color: W80, border: `1px solid ${BORDER}` }}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: W50 }}>
                End
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{ background: SURFACE2, color: W80, border: `1px solid ${BORDER}` }}
                />
              </label>
            </div>
            <button
              onClick={confirmDates}
              className="self-start px-5 py-3 rounded-lg font-bold uppercase tracking-wider text-sm transition-colors"
              style={{ background: Y, color: BG }}
            >
              Continue
            </button>
          </div>
        )}

        {/* Step: country (multi) */}
        {step === 'country' && (
          <CheckboxStep
            title="Countries"
            options={countries}
            selected={countrySel}
            onToggle={toggle(setCountrySel)}
            onSelectAll={() => setCountrySel(countries)}
            onClearAll={() => setCountrySel([])}
            onSubmit={submitCountries}
            submitLabel="Continue"
            loading={loading}
            emptyMsg="No shows in this date range."
          />
        )}

        {/* Step: state (multi, conditional) */}
        {step === 'state' && (
          <CheckboxStep
            title="States"
            options={states}
            selected={stateSel}
            onToggle={toggle(setStateSel)}
            onSelectAll={() => setStateSel(states)}
            onClearAll={() => setStateSel([])}
            onSubmit={submitStates}
            submitLabel="Continue"
            loading={loading}
            emptyMsg="No states for the selected countries."
          />
        )}

        {/* Step: city (multi) */}
        {step === 'city' && (
          <CheckboxStep
            title="Cities"
            options={cities}
            selected={citySel}
            onToggle={toggle(setCitySel)}
            onSelectAll={() => setCitySel(cities)}
            onClearAll={() => setCitySel([])}
            onSubmit={submitCities}
            submitLabel="Show results"
            loading={loading}
            emptyMsg="No cities for the current selection."
          />
        )}

        {/* Step: results */}
        {step === 'results' && (
          <div className="flex flex-col gap-4">
            {/* Client/event name + group toggle */}
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs flex-1 min-w-[200px]" style={{ color: W50 }}>
                Client / Event name
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Acme Brand — Summer Activation"
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{ background: SURFACE2, color: W80, border: `1px solid ${BORDER}` }}
                />
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setGroup('city')}
                  className="px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{
                    background: group === 'city' ? Y : SURFACE2,
                    color: group === 'city' ? BG : W80,
                    border: `1px solid ${group === 'city' ? Y : BORDER}`,
                    fontWeight: group === 'city' ? 600 : 400,
                  }}
                >
                  By city
                </button>
                <button
                  onClick={() => setGroup('artist')}
                  className="px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{
                    background: group === 'artist' ? Y : SURFACE2,
                    color: group === 'artist' ? BG : W80,
                    border: `1px solid ${group === 'artist' ? Y : BORDER}`,
                    fontWeight: group === 'artist' ? 600 : 400,
                  }}
                >
                  By artist
                </button>
              </div>
              <button
                onClick={exportPdf}
                disabled={visible.length === 0}
                className="px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors"
                style={{
                  background: visible.length === 0 ? SURFACE3 : Y,
                  color: visible.length === 0 ? W30 : BG,
                  cursor: visible.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Export PDF
              </button>
            </div>

            {loading ? (
              <p style={{ color: W30 }}>Loading…</p>
            ) : visible.length === 0 ? (
              <p style={{ color: W30 }}>No shows match the current selection.</p>
            ) : group === 'artist' ? (
              <div className="flex flex-col gap-3">
                {byArtist.map((g) => (
                  <ArtistCard key={g.key} group={g} onRemoveShow={removeShow} onRemoveArtist={removeArtist} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                {byCity.map((country) => (
                  <div key={country.country} className="flex flex-col gap-5">
                    {/* Country band (editorial, top level) */}
                    <h2
                      className="text-base font-bold uppercase tracking-wider pb-2"
                      style={{ color: Y, borderBottom: `2px solid ${Y}` }}
                    >
                      {country.countryLabel}
                    </h2>
                    {country.cities.map((city) => (
                      <div key={city.label} className="flex flex-col gap-3">
                        {/* City subheader (nested under the country) */}
                        <h3
                          className="text-xs font-semibold uppercase tracking-wider"
                          style={{ color: W50 }}
                        >
                          {city.label}
                        </h3>
                        {city.cards.map((g) => (
                          <ArtistCard
                            key={g.key}
                            group={g}
                            onRemoveShow={removeShow}
                            onRemoveArtist={removeArtist}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
