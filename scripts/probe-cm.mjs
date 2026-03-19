import { readFileSync } from 'fs'

const env = readFileSync('.env.local', 'utf8')
const cmToken = env.match(/CHARTMETRIC_TOKEN=(.+)/)[1].trim()

const authRes = await fetch('https://api.chartmetric.com/api/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refreshtoken: cmToken })
})
const { token } = await authRes.json()
console.log('Got CM token')

const res = await fetch(
  'https://api.chartmetric.com/api/artist/11706595/instagram-audience-stats',
  { headers: { 'Authorization': `Bearer ${token}` } }
)
const data = await res.json()
const obj = data.obj

if (!obj) {
  console.log('No obj in response. Full response:')
  console.log(JSON.stringify(data, null, 2))
} else {
  console.log('Top-level keys:', Object.keys(obj))
  console.log('')

  for (const key of Object.keys(obj)) {
    if (key.toLowerCase().includes('brand') || key.toLowerCase().includes('affinity') || key.toLowerCase().includes('interest')) {
      const val = obj[key]
      console.log(key + ':', Array.isArray(val) ? val.length + ' items' : typeof val)
      if (Array.isArray(val) && val.length > 0) {
        console.log('  Sample:', JSON.stringify(val[0]))
      }
    }
  }
}
