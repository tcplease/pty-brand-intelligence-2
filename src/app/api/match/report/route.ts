import { runBrandSearch, type BrandSearchResult } from '@/lib/brand-search'

const WON_STAGE = 'Won (Final On-Sale Planned)'

// PTY_DATA artist shape consumed by /report/report.js (Ledger layout)
interface ReportArtist {
  name: string
  genre: string | null
  stage: string | null
  demoMatch: number
  affinity: number
  spotify: number | null
  instagram: number | null
  tiktok: number | null
  imageUrl: string | null
}

function titleCaseGender(g: string): string {
  if (g === 'female') return 'Female'
  if (g === 'male') return 'Male'
  return 'Any'
}

function escapeForScript(json: string): string {
  // Neutralize </script> and HTML-comment sequences inside the inlined JSON
  return json.replace(/</g, '\\u003c')
}

function htmlDocument(data: unknown): string {
  const payload = escapeForScript(JSON.stringify(data))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PTY Artist Intelligence Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600;700;800&family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/report/styles.css">
</head>
<body>
  <div id="doc"></div>
  <script>window.PTY_DATA = ${payload};</script>
  <script src="/report/report.js"></script>
</body>
</html>`
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const sp = url.searchParams

  const brand = sp.get('brand') || ''
  const sector = sp.get('sector') || ''
  const gender = sp.get('gender') || 'any'
  const threshold = parseFloat(sp.get('threshold') || '0')
  const ages = sp.get('ages')?.split(',').filter(Boolean) || []

  // Client-side filters mirrored from the Match grid so the report == shown set
  const careerStages = new Set(sp.get('careerStages')?.split(',').filter(Boolean) || [])
  const dealStages = new Set(sp.get('dealStages')?.split(',').filter(Boolean) || [])
  const wonUpcoming = sp.get('wonUpcoming') === '1'

  try {
    const results = await runBrandSearch({ brand, sector, gender, threshold, ages })

    const fourteenDaysOut = new Date()
    fourteenDaysOut.setDate(fourteenDaysOut.getDate() + 14)
    const fourteenDaysOutStr = fourteenDaysOut.toISOString().split('T')[0]

    const filtered = results.filter((a: BrandSearchResult) => {
      if (careerStages.size > 0 && (!a.career_stage || !careerStages.has(a.career_stage))) return false
      if (dealStages.size > 0 && (!a.deal_stage || !dealStages.has(a.deal_stage))) return false
      if (wonUpcoming) {
        if (a.deal_stage !== WON_STAGE) return false
        if (!a.first_show || a.first_show < fourteenDaysOutStr) return false
      }
      return true
    })

    const artists: ReportArtist[] = filtered.map((a) => ({
      name: a.name,
      genre: a.primary_genre,
      stage: a.career_stage, // raw lowercase; report.js maps the chip + applies Mid-Level+ cutoff
      demoMatch: a.demographic_pct,
      affinity: a.affinity_score, // NOT combined_score
      spotify: a.spotify_followers,
      instagram: a.instagram_followers,
      tiktok: a.tiktok_followers,
      imageUrl: a.image_url,
    }))

    const clientName = brand || sector || 'All Artists'
    const generated = new Date().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })

    const data = {
      meta: {
        reportTitle: 'Partnership Match Report',
        query: clientName,
        ageBands: ages.length > 0 ? ages : ['All'],
        gender: titleCaseGender(gender),
        minMatch: threshold,
        generated,
        // artistCount is recomputed by the renderer as the shown (filtered) count
      },
      artists,
    }

    return new Response(htmlDocument(data), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(`<!doctype html><meta charset="utf-8"><pre>Report error: ${message.replace(/</g, '&lt;')}</pre>`, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}
