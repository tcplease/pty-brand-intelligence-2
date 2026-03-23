// ── Spotify API client (Client Credentials flow) ─────
// Free tier, rate-limited — use conservatively
// Used for pre-save / upcoming album detection

interface SpotifyToken {
  access_token: string
  expires_at: number
}

let cachedToken: SpotifyToken | null = null

export async function getSpotifyToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at) {
    return cachedToken.access_token
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET')
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    throw new Error(`Spotify auth failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  }

  return cachedToken.access_token
}

export interface SpotifyAlbum {
  id: string
  name: string
  album_type: 'album' | 'single' | 'compilation'
  release_date: string
  release_date_precision: 'day' | 'month' | 'year'
  total_tracks: number
  external_urls: { spotify: string }
  images: { url: string; width: number; height: number }[]
}

interface SpotifyAlbumsResponse {
  items: SpotifyAlbum[]
  total: number
  next: string | null
}

export async function getArtistAlbums(token: string, spotifyId: string): Promise<SpotifyAlbum[]> {
  const res = await fetch(
    `https://api.spotify.com/v1/artists/${spotifyId}/albums?include_groups=album,single&limit=50&market=US`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    }
  )

  if (!res.ok) {
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '5')
      console.warn(`Spotify rate limited, waiting ${retryAfter}s`)
      await sleep(retryAfter * 1000)
      return getArtistAlbums(token, spotifyId)
    }
    console.error(`Spotify albums error for ${spotifyId}: ${res.status}`)
    return []
  }

  const data: SpotifyAlbumsResponse = await res.json()
  return data.items
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
