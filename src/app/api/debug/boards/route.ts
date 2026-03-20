import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const query = `{
      boards(limit: 50) {
        id
        name
        items_count
      }
    }`

    const res = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
        'API-Version': '2023-10',
      },
      body: JSON.stringify({ query }),
    })

    const json = await res.json()
    return NextResponse.json(json.data?.boards || json)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}