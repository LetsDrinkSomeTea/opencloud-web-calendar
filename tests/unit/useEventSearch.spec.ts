import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { getSearchRange, useEventSearch } from '../../src/composables/useEventSearch'
import { initCalendarConfig } from '../../src/config'
import type { Calendar, CalendarEvent } from '../../src/types/calendar'

const searchEvents = vi.hoisted(() => vi.fn())
vi.mock('../../src/caldav/search', () => ({ searchEvents }))

function event(uid: string, summary: string, start: Date, calendarHref = '/cal/a/') {
  return {
    uid,
    summary,
    start,
    end: new Date(start.getTime() + 3600000),
    calendarHref,
    href: `${calendarHref}${uid}.ics`,
    etag: '',
    allDay: false,
    icsData: '',
    isRecurring: false
  } as CalendarEvent
}

const calendars: Calendar[] = [
  { href: '/cal/a/', displayName: 'A', color: '#f00', ctag: '', visible: true },
  { href: '/cal/b/', displayName: 'B', color: '#0f0', ctag: '', visible: false }
]
const now = new Date(2026, 9, 26, 12)
const loadedRange = { start: new Date(2026, 8, 1), end: new Date(2026, 11, 1) }

function setup(query: string, loaded: CalendarEvent[]) {
  const q = ref(query)
  const search = useEventSearch({
    query: q,
    calendars: () => calendars,
    loadedEvents: () => loaded,
    loadedRange: () => loadedRange,
    now: () => now
  })
  return { q, search }
}

describe('useEventSearch', () => {
  beforeEach(() => {
    searchEvents.mockReset()
    initCalendarConfig({})
  })

  it('searches ±searchRangeMonths around today', () => {
    expect(getSearchRange(12, now)).toEqual({
      start: new Date(2025, 9, 26),
      end: new Date(2027, 9, 27)
    })
  })

  it('merges loaded matches (diacritics insensitive) with server results, sorted', async () => {
    const far = event('far', 'Müller review', new Date(2027, 5, 1))
    const near = event('near', 'Call Mueller', new Date(2026, 9, 27))
    const loadedMatch = event('loaded', 'Treffen Muller', new Date(2026, 9, 20))
    searchEvents.mockResolvedValue([far, loadedMatch, event('hidden', 'Müller', now, '/cal/b/')])

    const { search } = setup('müller', [loadedMatch, near])
    expect(search.active.value).toBe(true)
    expect(search.loading.value).toBe(true)
    await flushPromises()

    expect(searchEvents).toHaveBeenCalledWith(calendars, 'müller', getSearchRange(12, now))
    expect(search.loading.value).toBe(false)
    expect(search.results.value.map((e) => e.uid)).toEqual(['loaded', 'far'])
    expect(search.range.value).toEqual(getSearchRange(12, now))
  })

  it('falls back to the loaded events when the server search fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    searchEvents.mockRejectedValue(new Error('403'))
    const { search } = setup('cafe', [event('x', 'Café', now)])
    await flushPromises()
    expect(search.serverFailed.value).toBe(true)
    expect(search.results.value.map((e) => e.uid)).toEqual(['x'])
    expect(search.range.value).toEqual(loadedRange)
  })

  it('only filters loaded events when the server search is disabled', async () => {
    initCalendarConfig({ searchRangeMonths: 0 })
    const { search } = setup('cafe', [event('x', 'Café', now), event('y', 'Other', now)])
    await flushPromises()
    expect(searchEvents).not.toHaveBeenCalled()
    expect(search.results.value.map((e) => e.uid)).toEqual(['x'])
    expect(search.range.value).toEqual(loadedRange)
  })

  it('is inactive without a query and ignores outdated responses', async () => {
    let resolveFirst: (events: CalendarEvent[]) => void = () => undefined
    searchEvents.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
    searchEvents.mockResolvedValueOnce([])
    const { q, search } = setup('old', [])
    q.value = ''
    await flushPromises()
    expect(search.active.value).toBe(false)
    resolveFirst([event('old', 'old', now)])
    await flushPromises()
    expect(search.results.value).toEqual([])
    expect(search.loading.value).toBe(false)
  })
})
