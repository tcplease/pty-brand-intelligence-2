import LiveClient from './LiveClient'

// Next 16: searchParams is a Promise — await it in the server shell, then hand
// the initial values to the client component, which hydrates state in useEffect.
// Multi-select selections arrive as repeated keys (countries=US&countries=CA),
// which Next surfaces as string[] (or a bare string for a single value).
interface LiveSearchParams {
  start?: string
  end?: string
  countries?: string | string[]
  states?: string | string[]
  cities?: string | string[]
  group?: string
}

function toArray(v: string | string[] | undefined): string[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<LiveSearchParams>
}) {
  const sp = await searchParams
  return (
    <LiveClient
      initial={{
        start: sp.start ?? '',
        end: sp.end ?? '',
        countries: toArray(sp.countries),
        states: toArray(sp.states),
        cities: toArray(sp.cities),
        group: sp.group === 'artist' ? 'artist' : 'city',
      }}
    />
  )
}
