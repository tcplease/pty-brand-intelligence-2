import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { prompt, context } = await request.json()

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: `You are a pitch writer for Please & Thank You (P&TY), a premium VIP experiences and brand partnerships company in live music.

Rules:
- Write as a P&TY representative
- Never include projected gross revenue
- Never claim a brand has no live music partner
- Be specific using the artist data provided
- Keep it concise and compelling

Artist Data:
${context}

Request: ${prompt}`,
          },
        ],
      }),
    })

    const data = await res.json()

    if (data.error) {
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    const pitch = data.content?.[0]?.text ?? 'No response generated.'
    return NextResponse.json({ pitch })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}