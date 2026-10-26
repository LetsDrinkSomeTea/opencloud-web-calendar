import { ref, computed, readonly } from 'vue'
import { useGettext } from 'vue3-gettext'
import { getCalDAVClient, type EventResource } from '../caldav/client'
import {
  AuthenticationError,
  CalDAVError,
  InvalidSyncTokenError,
  NetworkError,
  NotFoundError
} from '../caldav/errors'
import type { Calendar, CalendarEvent, DateRange } from '../types/calendar'
import type { CollectionState } from '../types/caldav'
import { useErrorMessage } from './useErrorMessage'

/**
 * Event cache of one calendar for the current date range.
 *
 * Only resources with events in the range are kept (recurring events expanded for the range),
 * so memory stays proportional to what is shown, not to the size of the calendar. Changes are
 * detected with the collection's ctag and applied with `sync-collection` (RFC 6578): the
 * server reports changed and removed hrefs since `syncToken`, changed ones are fetched with a
 * `calendar-multiget` and re-expanded for the range (they may have moved in or out of it).
 */
interface CalendarCache {
  rangeKey: string
  /** `getctag` at (or before) the time `resources` were fetched */
  ctag: string
  /** `null` if the server does not support sync-collection for this calendar */
  syncToken: string | null
  /** Resource href → resource with its events in the range */
  resources: Map<string, EventResource>
}

export interface RefreshOptions {
  /**
   * Skip the ctag comparison. Used after own changes: the ctags known from the last calendar
   * poll are outdated then, but the sync token still yields exactly the changes.
   */
  force?: boolean
}

const events = ref<CalendarEvent[]>([])
const loading = ref(false)
const error = ref<Error | null>(null)
const currentRange = ref<DateRange | null>(null)
const caches = new Map<string, CalendarCache>()
// Calendars whose server rejected sync-collection (other than for an invalid token)
const syncUnsupported = new Set<string>()
let latestCalendars: readonly Calendar[] = []
// All loads and syncs run one after another, so they never apply results out of order
let queue: Promise<unknown> = Promise.resolve()
// Events are re-fetched often, so a failure is reported once until fetching succeeds again
let fetchErrorReported = false

function normalizeHref(href: string): string {
  return href.endsWith('/') ? href : `${href}/`
}

function rangeKey(range: DateRange): string {
  return `${range.start.getTime()}-${range.end.getTime()}`
}

function rebuildEvents(): void {
  const result: CalendarEvent[] = []
  for (const cache of caches.values()) {
    for (const resource of cache.resources.values()) {
      result.push(...resource.events)
    }
  }
  events.value = result
}

/** Errors that would fail the same way on a full reload, so falling back makes no sense */
function isFatal(err: unknown): boolean {
  return (
    err instanceof AuthenticationError ||
    err instanceof NetworkError ||
    err instanceof NotFoundError ||
    !(err instanceof CalDAVError)
  )
}

/** Resets all cached events, e.g. on logout or in tests. */
export function resetEventCache(): void {
  caches.clear()
  syncUnsupported.clear()
  events.value = []
  currentRange.value = null
  latestCalendars = []
  queue = Promise.resolve()
  fetchErrorReported = false
}

export function useEvents() {
  const client = getCalDAVClient()
  const { $gettext } = useGettext()
  const { showError } = useErrorMessage()

  function enqueue(task: () => Promise<void>): Promise<void> {
    const next = queue.then(task, task)
    queue = next.catch((): void => undefined)
    return next
  }

  /** Change markers of a calendar: from the calendar list if known, else via PROPFIND. */
  async function getCollectionState(calendar: Calendar): Promise<CollectionState> {
    if (calendar.ctag || calendar.syncToken) {
      return { ctag: calendar.ctag || undefined, syncToken: calendar.syncToken }
    }
    try {
      return await client.fetchCollectionState(calendar.href)
    } catch (err) {
      if (isFatal(err)) throw err
      // The server doesn't report change markers, the calendar is fully reloaded
      return {}
    }
  }

  /** Full load of a calendar for the range (`calendar-query` with time-range). */
  async function loadCalendar(
    calendar: Calendar,
    range: DateRange,
    state: CollectionState
  ): Promise<void> {
    // The change markers are read before the events, so a change in between is reported by the
    // next sync (and skipped there because the ETag is already known)
    const resources = await client.fetchEventResources(calendar.href, range)
    caches.set(normalizeHref(calendar.href), {
      rangeKey: rangeKey(range),
      ctag: state.ctag ?? '',
      syncToken: syncUnsupported.has(normalizeHref(calendar.href))
        ? null
        : (state.syncToken ?? null),
      resources: new Map(resources.filter((r) => r.events.length > 0).map((r) => [r.href, r]))
    })
  }

  async function syncCalendar(
    calendar: Calendar,
    range: DateRange,
    { force = false }: RefreshOptions
  ): Promise<void> {
    const cache = caches.get(normalizeHref(calendar.href))

    if (!cache || cache.rangeKey !== rangeKey(range)) {
      await loadCalendar(calendar, range, await getCollectionState(calendar))
      return
    }

    const state = await getCollectionState(calendar)
    if (!force) {
      if (state.ctag && state.ctag === cache.ctag) return
      if (state.syncToken && state.syncToken === cache.syncToken) {
        // Only collection properties (name, color) changed
        cache.ctag = state.ctag ?? cache.ctag
        return
      }
    }

    if (!cache.syncToken) {
      // No incremental sync possible
      await loadCalendar(calendar, range, force ? await freshState(calendar) : state)
      return
    }

    let changes
    try {
      changes = await client.syncCollection(calendar.href, cache.syncToken)
    } catch (err) {
      if (isFatal(err)) throw err
      // Invalid/expired token or sync-collection not supported: full resync with a fresh token
      const fresh = await freshState(calendar)
      if (!(err instanceof InvalidSyncTokenError)) syncUnsupported.add(normalizeHref(calendar.href))
      await loadCalendar(calendar, range, fresh)
      return
    }

    for (const href of changes.removed) {
      cache.resources.delete(href)
    }

    const toFetch = changes.changed
      .filter((change) => cache.resources.get(change.href)?.etag !== change.etag)
      .map((change) => change.href)

    if (toFetch.length > 0) {
      const fetched = await client.multigetEventResources(calendar.href, toFetch, range)
      const fetchedHrefs = new Set<string>()
      for (const resource of fetched) {
        fetchedHrefs.add(resource.href)
        if (resource.events.length > 0) {
          cache.resources.set(resource.href, resource)
        } else {
          // Moved out of the range
          cache.resources.delete(resource.href)
        }
      }
      // Deleted between the sync and the multiget
      for (const href of toFetch) {
        if (!fetchedHrefs.has(href)) cache.resources.delete(href)
      }
    }

    cache.syncToken = changes.syncToken
    if (state.ctag) cache.ctag = state.ctag
  }

  /** Change markers read directly from the server, bypassing the calendar list. */
  function freshState(calendar: Calendar): Promise<CollectionState> {
    return getCollectionState({ ...calendar, ctag: '', syncToken: undefined })
  }

  async function syncAll(options: RefreshOptions, showLoading: boolean): Promise<void> {
    const range = currentRange.value
    if (!range) return
    const calendars = latestCalendars

    // Drop caches of calendars that were removed, left or unsubscribed
    const known = new Set(calendars.map((c) => normalizeHref(c.href)))
    for (const href of caches.keys()) {
      if (!known.has(href)) caches.delete(href)
    }

    // Hidden calendars keep their cache and are synced when they are shown again
    const visible = calendars.filter((c) => c.visible)
    const needsFullLoad = visible.some(
      (c) => caches.get(normalizeHref(c.href))?.rangeKey !== rangeKey(range)
    )
    if (showLoading && needsFullLoad) loading.value = true
    error.value = null

    try {
      const results = await Promise.allSettled(
        visible.map((calendar) => syncCalendar(calendar, range, options))
      )
      rebuildEvents()

      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failed) throw failed.reason
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

  /**
   * Shows the events of the calendars for the range. Calendars that are already cached for
   * this range are only synced incrementally.
   */
  function fetchEvents(calendars: readonly Calendar[], range: DateRange): Promise<void> {
    latestCalendars = calendars
    currentRange.value = range
    // The task reads the latest range and calendars when it runs, so queued navigation only
    // loads the range that is shown in the end
    return enqueue(() => syncAll({}, true))
  }

  /**
   * Incremental refresh of the current range: unchanged calendars (same ctag) cost no request,
   * changed ones one `sync-collection` plus one `calendar-multiget` for the changed resources.
   */
  function refreshEvents(
    calendars: readonly Calendar[],
    options: RefreshOptions = {}
  ): Promise<void> {
    latestCalendars = calendars
    return enqueue(() => syncAll(options, false))
  }

  function getVisibleEvents(calendars: readonly Calendar[]): CalendarEvent[] {
    const visibleHrefs = new Set(
      calendars.filter((c) => c.visible).map((c) => normalizeHref(c.href))
    )
    return events.value.filter((e) => visibleHrefs.has(normalizeHref(e.calendarHref)))
  }

  function updateResource(href: string, update: (resource: EventResource) => void): void {
    for (const cache of caches.values()) {
      const resource = cache.resources.get(href)
      if (resource) {
        update(resource)
        if (resource.events.length === 0) cache.resources.delete(href)
        return
      }
    }
  }

  function addEvent(event: CalendarEvent): void {
    const cache = caches.get(normalizeHref(event.calendarHref))
    const resource = cache?.resources.get(event.href)
    if (resource) {
      resource.events = [...resource.events, event]
    } else {
      cache?.resources.set(event.href, { href: event.href, etag: event.etag, events: [event] })
    }
    events.value = [...events.value, event]
  }

  function updateEventInCache(updatedEvent: CalendarEvent): void {
    const matches = (e: CalendarEvent) =>
      updatedEvent.recurrenceId
        ? e.uid === updatedEvent.uid && e.recurrenceId === updatedEvent.recurrenceId
        : e.uid === updatedEvent.uid

    updateResource(updatedEvent.href, (resource) => {
      resource.etag = updatedEvent.etag
      resource.events = resource.events.map((e) => (matches(e) ? updatedEvent : e))
    })
    events.value = events.value.map((e) => (matches(e) ? updatedEvent : e))
  }

  function removeEvent(uid: string, recurrenceId?: string): void {
    const matches = (e: CalendarEvent) =>
      recurrenceId ? e.uid === uid && e.recurrenceId === recurrenceId : e.uid === uid

    for (const event of events.value.filter(matches)) {
      updateResource(event.href, (resource) => {
        resource.events = resource.events.filter((e) => !matches(e))
      })
    }
    events.value = events.value.filter((e) => !matches(e))
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
