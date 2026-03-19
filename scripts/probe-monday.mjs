import { readFileSync } from 'fs'

// Read token from .env.local
const env = readFileSync('.env.local', 'utf8')
const match = env.match(/MONDAY_API_TOKEN=(.+)/)
const TOKEN = match[1].trim()

console.log('Token starts with:', TOKEN.slice(0, 5) + '...')

const res = await fetch('https://api.monday.com/v2', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`,
    'API-Version': '2023-10'
  },
  body: JSON.stringify({
    query: `{
      boards(ids: 3979002729) {
        name
        columns { id title type }
        items_page(limit: 3) {
          items {
            name
            column_values { id type text value }
          }
        }
      }
    }`
  })
})

const d = await res.json()
console.log(JSON.stringify(d, null, 2))

if (d.data) {
  console.log('')
  console.log('Board:', d.data.boards[0].name)
  console.log('')
  console.log('=== COLUMNS ===')
  d.data.boards[0].columns.forEach(c => console.log(c.id, '|', c.title, '|', c.type))
  console.log('')
  console.log('=== SAMPLE ITEM ===')
  const item = d.data.boards[0].items_page.items[0]
  console.log('Name:', item.name)
  item.column_values.forEach(v => {
    if (v.text || v.value) console.log(v.id, '|', v.text, '|', v.type)
  })
}
