// scripts/import-contacts.ts
// Run with: npx tsx scripts/import-contacts.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import contacts from './contacts_import.json'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
  console.log('Starting...')

  // Get all artists
  const { data: artists, error: artistError } = await supabase
    .from('intel_artists')
    .select('chartmetric_id, name')

  console.log('Artists fetched:', artists?.length ?? 0, 'Error:', artistError?.message ?? 'none')

  if (artistError || !artists) {
    console.error('Failed to fetch artists, stopping.')
    return
  }

  const nameToId = new Map(
    artists.map(a => [a.name.toLowerCase().trim(), a.chartmetric_id])
  )

  const toInsert: any[] = []
  const unmatched = new Set<string>()

  for (const contact of contacts as any[]) {
    const cmId = nameToId.get(contact.artist_name?.toLowerCase().trim())
    if (!cmId) { unmatched.add(contact.artist_name); continue }

    let phone = contact.phone?.replace(/\.0$/, '').trim() || null
    if (phone === 'nan' || phone === '') phone = null

    toInsert.push({
      chartmetric_id: cmId,
      role: contact.role,
      contact_name: contact.contact_name,
      company_name: contact.company_name,
      email: contact.email,
      phone,
      source: 'monday',
      last_verified_at: new Date().toISOString(),
    })
  }

  // Deduplicate
  const seen = new Set<string>()
  const deduped = toInsert.filter(r => {
    const key = `${r.chartmetric_id}|${r.contact_name}|${r.role}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`Matched: ${deduped.length}, Unmatched: ${unmatched.size}`)

  // Clear and re-insert
  console.log('Deleting old monday-sourced contacts...')
  const { error: deleteError } = await supabase.from('intel_artist_contacts').delete().eq('source', 'monday')
  console.log('Delete done. Error:', deleteError?.message ?? 'none')

  for (let i = 0; i < deduped.length; i += 200) {
    const { error } = await supabase.from('intel_artist_contacts').insert(deduped.slice(i, i + 200))
    if (error) console.error('Batch error:', error.message)
    else console.log(`Inserted ${Math.min(i + 200, deduped.length)}/${deduped.length}`)
  }

  console.log('Done')
}

run().catch(console.error)