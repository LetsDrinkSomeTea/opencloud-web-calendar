import { ref, computed, readonly } from 'vue'
import { useGettext } from 'vue3-gettext'
import { getCalDAVClient } from '../caldav/client'
import type { Calendar, CalendarEvent, DateRange } from '../types/calendar'
import { useErrorMessage } from './useErrorMessage'

const events = ref<CalendarEvent[]>([])
const loading = ref(false)
const error = ref<Error | null>(null)
const currentRange = ref<DateRange | null>(null)
// Events are re-fetched often, so a failure is reported once until fetching succeeds again
let fetchErrorReported = false

export function useEvents() {
  const client = getCalDAVClient()
  const { $gettext } = useGettext()
  const { showError } = useErrorMessage()

  async function fetchEvents(calendars: Calendar[], range: DateRange): Promise<void> {
    loading.value = true
    error.value = null
    currentRange.value = range

    try {
      events.value = await client.fetchAllEvents(calendars, range)
      fetchErrorReported = false
    } catch (err) {
      error.value = err instanceof Error ? err : new Error('Failed to fetch events')
      console.error('Failed to fetch events:', err)
      if (!fetchErrorReported) {
        fetchErrorReported = true
        showError($gettext('Failed to load events'), err)
      }
    } finally {
      loading.value = false
    }
  }

  async function refreshEvents(calendars: Calendar[]): Promise<void> {
    if (currentRange.value) {
      await fetchEvents(calendars, currentRange.value)
    }
  }

  function getVisibleEvents(calendars: Calendar[]): CalendarEvent[] {
    const normalize = (href: string) => (href.endsWith('/') ? href : href + '/')
    const visibleHrefs = new Set(calendars.filter((c) => c.visible).map((c) => normalize(c.href)))
    return events.value.filter((e) => visibleHrefs.has(normalize(e.calendarHref)))
  }

  function addEvent(event: CalendarEvent): void {
    events.value = [...events.value, event]
  }

  function updateEventInCache(updatedEvent: CalendarEvent): void {
    if (updatedEvent.recurrenceId) {
      // Update a specific occurrence
      events.value = events.value.map((e) =>
        e.uid === updatedEvent.uid && e.recurrenceId === updatedEvent.recurrenceId
          ? updatedEvent
          : e
      )
    } else {
      events.value = events.value.map((e) => (e.uid === updatedEvent.uid ? updatedEvent : e))
    }
  }

  function removeEvent(uid: string, recurrenceId?: string): void {
    if (recurrenceId) {
      // Remove a specific occurrence
      events.value = events.value.filter((e) => !(e.uid === uid && e.recurrenceId === recurrenceId))
    } else {
      // Remove all instances of this UID
      events.value = events.value.filter((e) => e.uid !== uid)
    }
  }

  function findEventByUid(uid: string): CalendarEvent | undefined {
    return events.value.find((e) => e.uid === uid)
  }

  const visibleEventsComputed = computed(() => events.value)

  return {
    events: readonly(events),
    loading: readonly(loading),
    error: readonly(error),
    currentRange: readonly(currentRange),
    visibleEvents: visibleEventsComputed,
    fetchEvents,
    refreshEvents,
    getVisibleEvents,
    addEvent,
    updateEventInCache,
    removeEvent,
    findEventByUid
  }
}
