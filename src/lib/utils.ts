/**
 * Format a number to a human-readable string
 * 8200000 → "8.2M", 152000 → "152K", 900 → "900"
 */
export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toLocaleString()
}

/**
 * Format currency
 * 297000 → "$297K", 1500000 → "$1.5M"
 */
export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K'
  return '$' + n.toLocaleString()
}

/**
 * Format a date string to a readable format
 * "2026-04-10" → "Apr 10, 2026"
 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '—'
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Get short stage label for badges
 * "Proposal (financials submitted)" → "Proposal"
 */
export function shortStage(stage: string | null): string {
  if (!stage) return ''
  // Take everything before the first parenthesis or dash
  const short = stage.split(/[(-]/)[0].trim()
  return short
}

/**
 * Copy text to clipboard with fallback
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    return success
  }
}
