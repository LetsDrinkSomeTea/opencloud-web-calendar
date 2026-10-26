import { ref } from 'vue'
import { useClientService } from '@opencloud-eu/web-pkg'
import { useCalendarConfig } from '../config'

export interface LocationResult {
  display_name: string
  lat: string
  lon: string
}

/**
 * Builds the request URL for a Nominatim compatible search endpoint.
 * Relative URLs (e.g. a same-origin proxy) are resolved against the current origin.
 */
export function buildLocationSearchUrl(baseUrl: string, query: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost'
  const url = new URL(baseUrl, origin)
  url.searchParams.set('format', 'json')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '5')
  return url.toString()
}

export function useLocationSearch() {
  const { locationSearch } = useCalendarConfig()
  const clientService = useClientService()
  const enabled = locationSearch.enabled
  const results = ref<LocationResult[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  function getLanguage(): string {
    return (
      clientService?.currentLanguage ||
      (typeof navigator !== 'undefined' ? navigator.language : '') ||
      'en'
    )
  }

  function search(query: string) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    if (!enabled || !query || query.length < 3) {
      results.value = []
      return
    }

    loading.value = true
    error.value = null

    timeoutId = setTimeout(async () => {
      try {
        const response = await fetch(buildLocationSearchUrl(locationSearch.url, query), {
          headers: {
            Accept: 'application/json',
            'Accept-Language': getLanguage()
          }
        })

        if (!response.ok) {
          throw new Error('Search failed')
        }

        const data = await response.json()
        results.value = data.map((item: any) => ({
          display_name: item.display_name,
          lat: item.lat,
          lon: item.lon
        }))
      } catch (err) {
        error.value = err instanceof Error ? err.message : 'Unknown error'
        results.value = []
      } finally {
        loading.value = false
      }
    }, 300)
  }

  function clearResults() {
    results.value = []
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }

  return {
    enabled,
    results,
    loading,
    error,
    search,
    clearResults
  }
}
