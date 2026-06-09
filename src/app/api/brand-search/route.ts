import { NextResponse } from 'next/server'
import { runBrandSearch } from '@/lib/brand-search'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const brand = url.searchParams.get('brand') || ''
  const sector = url.searchParams.get('sector') || ''
  const gender = url.searchParams.get('gender') || 'any' // 'male' | 'female' | 'any'
  const threshold = parseFloat(url.searchParams.get('threshold') || '0')
  const ages = url.searchParams.get('ages')?.split(',').filter(Boolean) || []

  try {
    const results = await runBrandSearch({ brand, sector, gender, threshold, ages })
    return NextResponse.json({ artists: results, count: results.length })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
