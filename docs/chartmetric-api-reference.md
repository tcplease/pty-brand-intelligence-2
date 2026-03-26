# Chartmetric API Reference

> Authoritative reference for all CM endpoints used in PTY Intel.
> NEVER use field names from one endpoint on a different endpoint.
> Last updated: March 26, 2026

---

## Authentication

```
POST https://api.chartmetric.com/api/token
Body: { "refreshtoken": CHARTMETRIC_TOKEN }
Returns: { "token": "Bearer token for subsequent calls" }
```

---

## Endpoints We Use

### 1. Artist Profile
```
GET /api/artist/{cmId}
```
**Returns:** name, image_url, cm_artist_score, artist_genres, career_status, general_manager, cover_url, description
**Does NOT return:** social stats (followers, listeners, subscribers). NEVER reference sp_followers, ins_followers, or tiktok_followers from this endpoint — they don't exist here.

### 2. Social Stats (REQUIRED for follower counts)
```
GET /api/artist/{cmId}/stat/spotify
GET /api/artist/{cmId}/stat/instagram
GET /api/artist/{cmId}/stat/youtube_channel
GET /api/artist/{cmId}/stat/tiktok
```
**Extract patterns:**
- `spotify_followers` → `response.obj.followers[0].value`
- `spotify_monthly_listeners` → `response.obj.monthly_listeners[0].value`
- `instagram_followers` → `response.obj.followers[0].value`
- `youtube_subscribers` → `response.obj.subscribers[0].value`
- `tiktok_followers` → `response.obj.followers[0].value`

**IMPORTANT:** Spotify endpoint returns BOTH followers and monthly_listeners. Only 4 API calls needed for all 5 stats (Spotify, Instagram, YouTube, TikTok).

### 3. Career Stage
```
GET /api/artist/{cmId}/career?limit=1
```
**Returns:** `response.obj[0].stage` (e.g. "superstar", "mainstream")
Also returns: `stage_score`, `momentum`, `momentum_score`

### 4. Artist URLs (for Spotify Artist ID)
```
GET /api/artist/{cmId}/urls
```
**Returns:** Array of `{ domain, url[] }` objects
**Spotify ID extraction:** Find `domain === 'spotify'`, parse ID from URL: `https://open.spotify.com/artist/{SPOTIFY_ID}`

### 5. Brand Affinities (Instagram audience)
```
GET /api/artist/{cmId}/instagram-audience-data?field=brandAffinity
```
**Returns:** Array of `{ id, name, affinity, followers, category }`
**Filter:** Only store `affinity >= 1.0`

### 6. Sector/Interest Affinities (Instagram audience)
```
GET /api/artist/{cmId}/instagram-audience-data?field=interests
```
**Returns:** Array of `{ id, name, affinity }`
**Filter:** Only store `affinity >= 1.0`

### 7. Instagram Audience Demographics
```
GET /api/artist/{cmId}/instagram-audience-stats
```
**Returns:** `audience_genders`, `audience_genders_per_age`, `audience_ethnicities`, `audience_geo`

### 8. Artist Search
```
GET /api/search?q={name}&type=artists&limit=3
```
**Returns:** `response.obj.artists[]` — array of matches with `id`, `name`

### 9. Festival List
```
GET /api/festival/list?code2s[]=US&sortColumn=startDate&sortOrderDesc=false&limit=100
```
**Returns:** Array of festivals with `id`, `name`, `date`, `city`, `country`, `eventSize`

### 10. Festival Lineup (Artist List Filter)
```
GET /api/artist/list/filter?eventIds[]={festivalId}&limit=100&sortColumn=sp_followers&sortOrderDesc=true
```
**Returns:** Artist objects WITH social stats included (`sp_followers`, `ins_followers`, `tiktok_followers`, `sp_monthly_listeners`, `ycs_subscribers`). This is the ONLY list endpoint that includes social stats inline.

---

## Full Artist Enrichment — Standard Call Sequence

When adding a new artist, ALWAYS run all of these (8 calls total):

1. Artist Profile → name, image, score, genre, manager (1 call)
2. Career Stage → career stage (1 call)
3. Social Stats → Spotify, Instagram, YouTube, TikTok (4 calls)
4. Brand Affinities → brand data (1 call)
5. Sector Affinities → interest data (1 call)

Optional:
6. Artist URLs → Spotify artist ID (1 call)
7. Instagram Audience Stats → demographics (1 call)

**The existing `/api/sync/chartmetric` route does all of this correctly. ALWAYS use it or replicate its exact logic. Never write ad-hoc scripts that skip social stats.**

---

## Common Mistakes to Avoid

1. **Using `profile.sp_followers`** — The profile endpoint does NOT return social stats. Use `/stat/spotify` etc.
2. **Skipping social stats in batch scripts** — Every new artist must get the full 8-call enrichment.
3. **Overwriting existing data** — Always strip null values before UPDATE. See CLAUDE.md rules 1-3.
4. **Running full batch without testing** — Always test on 1-3 artists first.

---

*P&TY Internal — Do not share externally*
