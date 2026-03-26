'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Brand colors ──────────────────────────────────────
const Y = '#F9D40A'
const SURFACE2 = '#1C1C1C'
const BORDER = 'rgba(255,255,255,0.08)'
const W80 = 'rgba(255,255,255,0.8)'
const W50 = 'rgba(255,255,255,0.5)'
const W30 = 'rgba(255,255,255,0.3)'

// ── Help content per page ─────────────────────────────
type HelpPage = 'pipeline' | 'radar' | 'match' | 'artist'

interface HelpEntry {
  label: string
  text: string
}

const HELP_CONTENT: Record<HelpPage, { title: string; entries: HelpEntry[] }> = {
  pipeline: {
    title: 'Pipeline Help',
    entries: [
      { label: 'Card anatomy', text: 'CM Score (top-right badge) | Genre (gray pill) | Career Stage (colored pill) | Deal Stage (colored pill) | Social stats (Spotify, Instagram, TikTok)' },
      { label: 'My Deals', text: 'Toggle to filter to artists where you are the sales lead' },
      { label: 'Search', text: 'Filter by artist name, genre, career stage, or deal stage' },
      { label: 'Dimmed cards', text: 'Outbound artists \u2014 full data available, just earlier in the pipeline' },
      { label: 'Click any card', text: 'View full artist intelligence, contacts, and pitch builder' },
    ],
  },
  radar: {
    title: 'Radar Help',
    entries: [
      { label: 'What shows here', text: 'Artists discovered via festival lineups, pre-saves, metric spikes, or submitted by your team' },
      { label: 'Add Leads', text: 'Paste an agency tour list to bulk-add artists with full Chartmetric data' },
      { label: 'Add to Pipeline', text: 'Moves the artist to Monday.com and assigns you as the sales lead' },
      { label: 'Source badge', text: 'Shows how the artist was discovered (festival, manual, pre-save)' },
    ],
  },
  match: {
    title: 'Match Help',
    entries: [
      { label: 'How to search', text: 'Enter a brand name or sector (required), then click Find' },
      { label: 'Demo match %', text: 'How closely the artist\u2019s audience demographics match your target filters (age, gender)' },
      { label: 'Affinity index', text: 'How much the artist\u2019s fans over-index on that brand/sector compared to average (2x = twice as likely)' },
      { label: 'Threshold slider', text: 'Set minimum demo match % to filter results' },
      { label: 'Career stage chips', text: 'Filter results by artist tier' },
    ],
  },
  artist: {
    title: 'Artist Page Help',
    entries: [
      { label: 'Contacts tab', text: 'Management and agency contacts from Monday.com. Tap to email/call on mobile, click to copy on desktop' },
      { label: 'Intelligence tab', text: 'Audience demographics, brand affinities (sortable by index), sector interests' },
      { label: 'Activity tab', text: 'Timeline of signals \u2014 festival bookings, stage changes, pre-saves' },
      { label: 'Pitch Builder tab', text: 'AI-powered email generator. Specify the pitch type (VIP or Brand) and target. Follows P&TY tone guidelines.' },
      { label: 'Brand affinity', text: '2x+ means the artist\u2019s fans are twice as likely to engage with that brand vs average' },
    ],
  },
}

interface HelpOverlayProps {
  page: HelpPage
}

export default function HelpOverlay({ page }: HelpOverlayProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleClose = useCallback(() => setOpen(false), [])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        handleClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, handleClose])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, handleClose])

  const content = HELP_CONTENT[page]

  return (
    <div className="relative" style={{ zIndex: 60 }}>
      {/* ? button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center justify-center rounded-full border transition-colors shrink-0"
        style={{
          width: 28,
          height: 28,
          borderColor: 'rgba(255,255,255,0.2)',
          color: W50,
          background: 'transparent',
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1,
          touchAction: 'manipulation',
        }}
        aria-label="Help"
      >
        ?
      </button>

      {/* Overlay panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-10 rounded-xl border shadow-2xl"
          style={{
            background: SURFACE2,
            borderColor: BORDER,
            maxWidth: 400,
            width: 'calc(100vw - 32px)',
            animation: 'helpFadeIn 200ms ease-out forwards',
          }}
        >
          {/* Inline keyframes for animation */}
          <style>{`
            @keyframes helpFadeIn {
              from { opacity: 0; transform: scale(0.95) translateY(-4px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <span className="text-sm font-semibold" style={{ color: Y }}>{content.title}</span>
            <button
              onClick={handleClose}
              className="flex items-center justify-center rounded transition-colors"
              style={{
                width: 24,
                height: 24,
                color: W30,
                background: 'transparent',
                fontSize: 16,
                lineHeight: 1,
              }}
              aria-label="Close help"
            >
              &times;
            </button>
          </div>

          {/* Entries */}
          <div className="px-4 pb-4 flex flex-col gap-3">
            {content.entries.map((entry) => (
              <div key={entry.label}>
                <span className="text-xs font-semibold" style={{ color: W80 }}>
                  {entry.label}
                </span>
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: W50, margin: 0 }}>
                  {entry.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
