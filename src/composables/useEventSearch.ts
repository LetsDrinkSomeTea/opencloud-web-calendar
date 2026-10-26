import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { searchEvents } from '../caldav/search'
import { useCalendarConfig } from '../config'
import { compareEvents, eventMatchesQuery, uniqueEvents } from '../utils/search'
import type { Calendar, CalendarEvent, DateRange } from '../types/calendar'

export interface EventSearchOptions {
  /** The (debounced) search query, `''` = no search */
  query: Ref<string>
  calendars: () => readonly Calendar[]
  /** Events already loaded for the calendar view (visible calendars only) */
  loadedEvents: () => readonly CalendarEvent[]
  /** Loaded range of `loadedEvents` */
  loadedRange: () => DateRange | null
  now?: () => Date
}

/** Window searched on the server: `months` before and after today */
export function getSearchRange(months: number, now: Date = new Date()): DateRange {
  return {
    start: new Date(now.getFullYear(), now.getMonth() - months, now.getDate()),
    end: new Date(now.getFullYear(), now.getMonth() + months, now.getDate() + 1)
  }
}

/**
 * Searches events by title, location and description. Loaded events are filtered on the client
 * (case and diacritics insensitive); in addition the visible calendars are searched on the
 * server with CalDAV `text-match` for `searchRangeMonths` before and after today.
 */
export function useEventSearch(options: EventSearchOptions) {
  const config = useCalendarConfig()
  const now = options.now ?? (() => new Date())

  const serverResults = shallowRef<CalendarEvent[]>([])
  const serverRange = ref<DateRange | null>(null)
  const loading = ref(false)
  /** The server search failed, only loaded events are shown */
  const serverFailed = ref(false)
  let searchId = 0

  const active = computed(() => options.query.value.trim() !== '')
  const serverSearchEnabled = computed(() => config.searchRangeMonths > 0)

  /** Range the results come from */
  const range = computed<DateRange | null>(() =>
    serverSearchEnabled.value && !serverFailed.value && serverRange.value
      ? serverRange.value
      : options.loadedRange()
  )

  const results = computed<CalendarEvent[]>(() => {
    const query = options.query.value
    if (!active.value) return []
    const local = options.loadedEvents().filter((event) => eventMatchesQuery(event, query))
    const visible = new Set(
      options
        .calendars()
        .filter((c) => c.visible)
        .map((c) => c.href.replace(/\/?$/, '/'))
    )
    const server = serverResults.value.filter((e) =>
      visible.has(e.calendarHref.replace(/\/?$/, '/'))
    )
    // Loaded events come first, they reflect local changes immediately
    return uniqueEvents([...local, ...server]).sort(compareEvents)
  })

  async function search(): Promise<void> {
    const id = ++searchId
    const query = options.query.value.trim()
    serverResults.value = []
    serverFailed.value = false
    if (!query || !serverSearchEnabled.value) {
      loading.value = false
      return
    }

    const searchRange = getSearchRange(config.searchRangeMonths, now())
    serverRange.value = searchRange
    loading.value = true
    try {
      const found = await searchEvents(options.calendars(), query, searchRange)
      if (id === searchId) serverResults.value = found
    } catch (err) {
      console.error('Failed to search events:', err)
      if (id === searchId) serverFailed.value = true
    } finally {
      if (id === searchId) loading.value = false
    }
  }

  watch(
    [
      options.query,
      () =>
        options
          .calendars()
          .filter((c) => c.visible)
          .map((c) => c.href)
          .join(',')
    ],
    () => search(),
    { immediate: true }
  )

  return {
    active,
    results,
    loading,
    range,
    serverFailed,
    serverSearchEnabled,
    /** Searches again, e.g. after an event was saved */
    refresh: search
  }
}
