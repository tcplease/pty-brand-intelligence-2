import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const board = url.searchParams.get('board') || '2696356486'
  const limit = parseInt(url.searchParams.get('limit') || '3')

  try {
    const query = `{
      boards(ids: ${board}) {
        name
        columns { id title type }
        items_page(limit: ${limit}) {
          items {
            id
            name
            column_values { id text value }
          }
        }
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
    const board_data = json.data?.boards?.[0]

    return NextResponse.json({
      board_name: board_data?.name,
      columns: board_data?.columns,
      sample_items: board_data?.items_page?.items?.map((item: any) => ({
        id: item.id,
        name: item.name,
        values: item.column_values
          .filter((c: any) => c.text)
          .map((c: any) => ({ id: c.id, text: c.text }))
      }))
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}