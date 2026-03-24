# Chartmetric API Reference for PTY Intel

Internal reference for all Chartmetric API endpoints used in this project.

Base URL: `https://api.chartmetric.com/api`

---

## Authentication

**POST** `/token`

```
Body: { "refreshtoken": "<CHARTMETRIC_TOKEN>" }
Response: { "token": "<bearer_token>" }
```

Bearer token is short-lived. Fetch a new one at the start of each sync job.

---

## Artist Endpoints

### Artist Profile

**GET** `/artist/{cmId}`

Returns: name, image_url, cm_artist_score, artist_genres, sp_followers, sp_monthly_listeners, ins_followers, ycs_subscribers, tiktok_followers, general_manager

Used in: CM sync (main profile data)

---

### Career Stage

**GET** `/artist/{cmId}/career?limit=1`

Returns: `obj[0].stage` (e.g., "superstar", "mainstream", "mid-level", "developing", "undiscovered"), `stage_score`, `momentum`, `momentum_score`

Note: `cm_artist_score` (the 0-100 score) comes from the `/artist/{cmId}` profile endpoint, NOT this one. This returns career stage labels only.

---

### Platform URLs (Spotify ID extraction)

**GET** `/artist/{cmId}/urls`

Returns: Array of `{ domain, url[] }` objects for all platforms.

To get Spotify artist ID:
```
const spEntry = obj.find(u => u.domain === 'spotify')
const spotifyUrl = spEntry?.url?.[0]  // "https://open.spotify.com/artist/3WrFJ7ztbogyGnTHbHJFl2"
const spotifyId = spotifyUrl.match(/artist\/([a-zA-Z0-9]+)/)[1]
```

---

### Instagram Audience Stats (demographics + affinities)

**GET** `/artist/{cmId}/instagram-audience-stats`

This is the single most valuable endpoint. Returns ALL of:
- `audience_genders` - array of `{ code: "male"|"female", weight: number }` (weight is percentage, e.g., 38.9)
- `audience_genders_per_age` - array of `{ code: "13-17"|"18-24"|"25-34"|"35-44"|"45-54"|"55-64"|"65+", weight: number }` per gender
- `audience_ethnicities` - array of `{ code: "white"|"hispanic"|"african_american"|"asian", weight: number }`
- `top_countries` - array of `{ code, name, weight }` sorted by weight
- `followers` - Instagram follower count
- `audience_brand_affinities` - array of `{ name, weight, category }` (weight is percentage * 100, so divide by 100 for affinity_scale)
- `audience_interests` - array of `{ name, weight }` (same weight format as brands)

Important: Brand/sector `weight` values from this endpoint are percentages * 100. Filter to `weight/100 >= 1.0` for meaningful affinities.

Used in: CM sync (demographics, brand affinities, sector interests)

---

### Social Platform Stats

**GET** `/artist/{cmId}/stat/spotify`

Returns: `obj.followers[0].value`, `obj.monthly_listeners[0].value`

**GET** `/artist/{cmId}/stat/instagram`

Returns: `obj.followers[0].value`

**GET** `/artist/{cmId}/stat/youtube_channel`

Returns: `obj.subscribers[0].value`

**GET** `/artist/{cmId}/stat/tiktok`

Returns: `obj.followers[0].value`

---

## Search

### Global Search

**GET** `/search?q={name}&type=artists&limit=1`

Returns: `obj.artists[]` with `id` (chartmetric_id), `name`, `image_url`, `cm_artist_score`, `sp_followers`, `sp_monthly_listeners`

Important: Do NOT use `/artist/search` - that endpoint expects a numeric ID, not a name.

---

## Festival Endpoints

### Festival List

**GET** `/festival/list?code2s[]=US&sortColumn=startDate&sortOrderDesc=false&limit=100&offset=0`

Returns: Array of festivals with `id`, `name`, `date`, `city`, `country`, `eventSize` ("small"|"medium"|"large"|"mega")

Filter client-side: only process festivals with future dates.

---

### Festival Lineup (Artist Filter by Event)

**GET** `/artist/list/filter?eventIds[]={festivalId}&limit=100&offset=0&sortColumn=sp_followers&sortOrderDesc=true`

Returns: `obj.obj[]` or `obj[]` - array of artists performing at the festival.

Each artist has: `cm_artist`, `name`, `image_url`, `career_status.stage`, `genres`, `sp_followers`, `sp_monthly_listeners`, `ins_followers`, `ycs_subscribers`, `tiktok_followers`

---

## Endpoints We Do NOT Use (confirmed wrong)

| Endpoint | Why it fails |
|----------|-------------|
| `/artist/{id}/fan-metrics/instagram/source/cm` | 404 - does not exist |
| `/artist/{id}/fan-metrics?source=spotify` | Wrong format for demographics |
| `/artist/search?q={name}` | Expects numeric ID, not name string |

---

## API Cost Notes

- **Weekly CM sync (all artists):** ~5 calls per artist (profile + career + audience + social stats + urls). For 300 artists = ~1,500 calls.
- **Festival cron (weekly):** 1 call for festival list + 1 per festival for lineup. ~30-40 calls/week.
- **New artist lookup:** 1 search + 1 profile + 1 career + 1 audience = 4 calls per artist.
- **Rate limiting:** Add 200-1000ms sleep between calls to avoid hitting limits.

---

*Last updated: March 2026*
