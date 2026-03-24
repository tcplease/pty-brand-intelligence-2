'use client'

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import Papa from 'papaparse'

const Y = '#F9D40A'
const BG = '#0f0f0f'
const SURFACE = '#141414'
const BORDER = 'rgba(255,255,255,0.08)'
const W80 = 'rgba(255,255,255,0.8)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'
const GREEN = '#00D26A'

interface PreviewRow {
  Artist: string
  'Career Stage': string
  'Recent Momentum': string
  'Consistent Growth': string
  'User Curation': string
}

interface ImportResult {
  total: number
  created: number
  updated: number
  failed: { name: string; reason: string }[]
  ambiguous: { name: string; matchedAs: string }[]
}

export default function RisingIndexImport() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [totalRows, setTotalRows] = useState(0)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((f: File) => {
    setFile(f)
    setResult(null)
    setError('')

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = Papa.parse<PreviewRow>(text, {
        header: true,
        skipEmptyLines: true,
        preview: 10,
      })

      if (parsed.errors.length > 0 && parsed.data.length === 0) {
        setError('Failed to parse CSV. Check the file format.')
        return
      }

      setPreview(parsed.data)

      // Count total rows
      const fullParse = Papa.parse(text, { header: true, skipEmptyLines: true })
      setTotalRows(fullParse.data.length)
    }
    reader.readAsText(f)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f && f.name.endsWith('.csv')) handleFile(f)
  }, [handleFile])

  const handleImport = async () => {
    if (!file) return
    setImporting(true)
    setProgress(`Processing ${totalRows} artists...`)
    setResult(null)
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/admin/import-rising-index', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setResult(data)
      }
    } catch {
      setError('Import failed. Please try again.')
    }

    setImporting(false)
    setProgress('')
  }

  const reset = () => {
    setFile(null)
    setPreview([])
    setTotalRows(0)
    setResult(null)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="min-h-screen" style={{ background: BG, fontFamily: 'system-ui, sans-serif' }}>
      {/* Nav */}
      <nav className="flex items-center gap-4 px-4 md:px-6 py-3 border-b sticky top-0 z-50"
        style={{ background: BG, borderColor: BORDER }}>
        <img src="/pty-logo.svg" alt="P&TY" className="h-9 w-auto shrink-0" />
        <div className="h-4 w-px shrink-0" style={{ backgroundColor: BORDER }} />
        <Link href="/" className="text-sm py-3 px-3 block transition-colors hover:text-white"
          style={{ color: W50, touchAction: 'manipulation' }}>Pipeline</Link>
        <Link href="/discovery" className="text-sm py-3 px-3 block transition-colors hover:text-white"
          style={{ color: W50, touchAction: 'manipulation' }}>Radar</Link>
        <Link href="/brand-search" className="text-sm py-3 px-3 block transition-colors hover:text-white"
          style={{ color: W50, touchAction: 'manipulation' }}>Match</Link>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-white mb-1">Rising Index Import</h1>
        <p className="text-sm mb-6" style={{ color: W50 }}>
          Upload a Chartmetric Rising Index CSV export to import new leads and update existing artist scores.
        </p>

        {/* Upload zone */}
        {!file && !result && (
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors hover:border-white/20"
            style={{ borderColor: BORDER }}
          >
            <div className="text-3xl mb-3">📄</div>
            <p className="text-sm font-medium text-white mb-1">Drop CSV here or click to browse</p>
            <p className="text-xs" style={{ color: W30 }}>Accepts .csv files up to 5MB</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
          </div>
        )}

        {/* Preview */}
        {file && !result && !importing && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-white font-medium">{file.name}</p>
                <p className="text-xs" style={{ color: Y }}>{totalRows} artists ready to import</p>
              </div>
              <button onClick={reset} className="text-xs px-3 py-1.5 rounded-lg border"
                style={{ borderColor: BORDER, color: W50 }}>Cancel</button>
            </div>

            {/* Preview table */}
            <div className="overflow-x-auto rounded-xl border mb-4" style={{ borderColor: BORDER }}>
              <table className="w-full text-sm" style={{ color: W80 }}>
                <thead>
                  <tr style={{ background: SURFACE }}>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider" style={{ color: W50 }}>Artist</th>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider" style={{ color: W50 }}>Stage</th>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider" style={{ color: W50 }}>Momentum</th>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider" style={{ color: W50 }}>Growth</th>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider" style={{ color: W50 }}>Curation</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td className="px-3 py-2 font-medium">{row.Artist}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: W50 }}>{row['Career Stage']}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: row['Recent Momentum'] === 'Explosive Growth' ? Y : GREEN }}>{row['Recent Momentum']}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row['Consistent Growth'] || '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row['User Curation'] || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalRows > 10 && (
              <p className="text-xs mb-4" style={{ color: W30 }}>Showing first 10 of {totalRows} rows</p>
            )}

            <button onClick={handleImport}
              className="px-6 py-3 rounded-lg font-medium text-sm"
              style={{ background: Y, color: BG }}>
              Import {totalRows} Artists
            </button>
          </div>
        )}

        {/* Importing progress */}
        {importing && (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mb-4"
              style={{ borderColor: Y, borderTopColor: 'transparent' }} />
            <p className="text-sm text-white">{progress}</p>
            <p className="text-xs mt-1" style={{ color: W30 }}>This may take a few minutes for new artists</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl p-4 mb-4 border" style={{ background: '#1a0505', borderColor: '#FF444433' }}>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Success */}
            <div className="rounded-xl p-4 border" style={{ background: '#051a0a', borderColor: '#00D26A33' }}>
              <p className="text-sm font-medium" style={{ color: GREEN }}>
                {result.created + result.updated} artists imported successfully
              </p>
              <p className="text-xs mt-1" style={{ color: W50 }}>
                {result.created} new, {result.updated} updated
              </p>
            </div>

            {/* Ambiguous */}
            {result.ambiguous.length > 0 && (
              <div className="rounded-xl p-4 border" style={{ background: '#1a1505', borderColor: `${Y}33` }}>
                <p className="text-sm font-medium" style={{ color: Y }}>
                  {result.ambiguous.length} artists had ambiguous matches
                </p>
                <ul className="mt-2 space-y-1">
                  {result.ambiguous.map((a, i) => (
                    <li key={i} className="text-xs" style={{ color: W50 }}>
                      "{a.name}" matched as "{a.matchedAs}"
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Failed */}
            {result.failed.length > 0 && (
              <div className="rounded-xl p-4 border" style={{ background: '#1a0505', borderColor: '#FF444433' }}>
                <p className="text-sm font-medium text-red-400">
                  {result.failed.length} artists could not be found
                </p>
                <ul className="mt-2 space-y-1">
                  {result.failed.map((f, i) => (
                    <li key={i} className="text-xs" style={{ color: W50 }}>
                      {f.name}: {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button onClick={reset}
              className="px-4 py-2 rounded-lg text-sm border"
              style={{ borderColor: BORDER, color: W80 }}>
              Import Another
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
