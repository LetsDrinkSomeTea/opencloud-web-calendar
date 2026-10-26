import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { resetEventCache, useEvents } from '../../src/composables/useEvents'
import { CalDAVError, InvalidSyncTokenError, NetworkError } from '../../src/caldav/errors'
import type { EventResource } from '../../src/caldav/client'
import type { Calendar, CalendarEvent } from '../../src/types/calendar'
import { createTestGettext } from './helpers/design-system'
import { messageStore, resetStores } from './helpers/web-pkg'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const client = vi.hoisted(() => ({
  fetchEventResources: vi.fn(),
  multigetEventResources: vi.fn(),
  fetchCollectionState: vi.fn(),
  syncCollection: vi.fn()
}))
vi.mock('../../src/caldav/client', () => ({ getCalDAVClient: () => client }))

function setup() {
  let result!: ReturnType<typeof useEvents>
  mount(
    defineComponent({
      setup() {
        result = useEvents()
        return () => h('div')
      }
    }),
    { global: { plugins: [createTestGettext('en')] } }
  )
  return result
}

const CAL = '/caldav/alice/personal/'
const range = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') }
const nextRange = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') }

function calendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    href: CAL,
    displayName: 'Personal',
    color: '#000',
    ctag: 'ctag-1',
    syncToken: 'token-1',
    visible: true,
    ...overrides
  }
}

function resource(name: string, etag: string, summary = name): EventResource {
  const href = `${CAL}${name}.ics`
  const event: CalendarEvent = {
    uid: name,
    calendarHref: CAL,
    href,
    etag,
    summary,
    start: new Date('2026-10-26T10:00:00Z'),
    end: new Date('2026-10-26T11:00:00Z'),
    allDay: false,
    icsData: '',
    isRecurring: false
  }
  return { href, etag, events: [event] }
}

const summaries = (events: readonly Pick<CalendarEvent, 'summary'>[]) =>
  events.map((e) => e.summary).sort()

beforeEach(() => {
  resetStores()
  resetEventCache()
  Object.values(client).forEach((fn) => fn.mockReset())
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

async function loaded() {
  const composable = setup()
  client.fetchEventResources.mockResolvedValue([resource('a', 'ea'), resource('b', 'eb')])
  await composable.fetchEvents([calendar()], range)
  client.fetchEventResources.mockReset()
  return composable
}

describe('useEvents incremental sync', () => {
  it('loads the range with a calendar-query and keeps the change markers', async () => {
    const { events } = await loaded()
    expect(summaries(events.value)).toEqual(['a', 'b'])
  })

  it('skips calendars whose ctag did not change', async () => {
    const { refreshEvents } = await loaded()
    await refreshEvents([calendar()])
    expect(client.syncCollection).not.toHaveBeenCalled()
    expect(client.fetchEventResources).not.toHaveBeenCalled()
    expect(client.fetchCollectionState).not.toHaveBeenCalled()
  })

  it('skips calendars whose sync token did not change (property changes only)', async () => {
    const { refreshEvents } = await loaded()
    await refreshEvents([calendar({ ctag: 'ctag-2' })])
    expect(client.syncCollection).not.toHaveBeenCalled()
  })

  it('fetches only changed resources and drops removed ones', async () => {
    const { events, refreshEvents } = await loaded()
    client.syncCollection.mockResolvedValue({
      syncToken: 'token-2',
      changed: [
        { href: `${CAL}a.ics`, etag: 'ea' }, // unchanged ETag, e.g. own change already cached
        { href: `${CAL}c.ics`, etag: 'ec' }
      ],
      removed: [`${CAL}b.ics`]
    })
    client.multigetEventResources.mockResolvedValue([resource('c', 'ec')])

    await refreshEvents([calendar({ ctag: 'ctag-2', syncToken: 'token-2' })])

    expect(client.syncCollection).toHaveBeenCalledWith(CAL, 'token-1')
    expect(client.multigetEventResources).toHaveBeenCalledWith(CAL, [`${CAL}c.ics`], range)
    expect(client.fetchEventResources).not.toHaveBeenCalled()
    expect(summaries(events.value)).toEqual(['a', 'c'])

    // The next sync continues from the new token
    client.syncCollection.mockResolvedValue({ syncToken: 'token-3', changed: [], removed: [] })
    await refreshEvents([calendar({ ctag: 'ctag-3', syncToken: 'token-3' })])
    expect(client.syncCollection).toHaveBeenLastCalledWith(CAL, 'token-2')
  })

  it('removes resources that moved out of the range or were deleted meanwhile', async () => {
    const { events, refreshEvents } = await loaded()
    client.syncCollection.mockResolvedValue({
      syncToken: 'token-2',
      changed: [
        { href: `${CAL}a.ics`, etag: 'ea2' },
        { href: `${CAL}b.ics`, etag: 'eb2' }
      ],
      removed: []
    })
    // a moved to December, b was deleted between the sync and the multiget
    client.multigetEventResources.mockResolvedValue([
      { href: `${CAL}a.ics`, etag: 'ea2', events: [] }
    ])

    await refreshEvents([calendar({ ctag: 'ctag-2', syncToken: 'token-2' })])
    expect(events.value).toEqual([])
  })

  it('updates modified resources', async () => {
    const { events, refreshEvents } = await loaded()
    client.syncCollection.mockResolvedValue({
      syncToken: 'token-2',
      changed: [{ href: `${CAL}a.ics`, etag: 'ea2' }],
      removed: []
    })
    client.multigetEventResources.mockResolvedValue([resource('a', 'ea2', 'renamed')])

    await refreshEvents([calendar({ ctag: 'ctag-2', syncToken: 'token-2' })])
    expect(summaries(events.value)).toEqual(['b', 'renamed'])
  })

  it('does a full resync with a fresh token when the sync token is invalid', async () => {
    const { events, refreshEvents } = await loaded()
    client.syncCollection.mockRejectedValue(new InvalidSyncTokenError())
    client.fetchCollectionState.mockResolvedValue({ ctag: 'ctag-9', syncToken: 'token-9' })
    client.fetchEventResources.mockResolvedValue([resource('z', 'ez')])

    await refreshEvents([calendar({ ctag: 'ctag-2', syncToken: 'token-2' })])

    expect(client.fetchCollectionState).toHaveBeenCalledWith(CAL)
    expect(client.fetchEventResources).toHaveBeenCalledWith(CAL, range)
    expect(summaries(events.value)).toEqual(['z'])

    client.syncCollection.mockReset()
    client.syncCollection.mockResolvedValue({ syncToken: 'token-10', changed: [], removed: [] })
    await refreshEvents([calendar({ ctag: 'ctag-10', syncToken: 'token-10' })])
    expect(client.syncCollection).toHaveBeenCalledWith(CAL, 'token-9')
  })

  it('falls back to time-range reloads when sync-collection is not supported', async () => {
    const { refreshEvents } = await loaded()
    client.syncCollection.mockRejectedValue(new CalDAVError('REPORT failed', 403))
    client.fetchCollectionState.mockResolvedValue({ ctag: 'ctag-9', syncToken: 'token-9' })
    client.fetchEventResources.mockResolvedValue([])

    await refreshEvents([calendar({ ctag: 'ctag-2', syncToken: 'token-2' })])
    expect(client.fetchEventResources).toHaveBeenCalledTimes(1)

    // No sync is attempted anymore, a changed ctag reloads the range
    await refreshEvents([calendar({ ctag: 'ctag-3', syncToken: 'token-3' })])
    await refreshEvents([calendar({ ctag: 'ctag-4', syncToken: 'token-4' })])
    expect(client.syncCollection).toHaveBeenCalledTimes(1)
    expect(client.fetchEventResources).toHaveBeenCalledTimes(3)

    // Unchanged ctag: nothing to do
    await refreshEvents([calendar({ ctag: 'ctag-4', syncToken: 'token-4' })])
    expect(client.fetchEventResources).toHaveBeenCalledTimes(3)
  })

  it('reports network failures instead of falling back', async () => {
    const { refreshEvents } = await loaded()
    client.syncCollection.mockRejectedValue(new NetworkError('offline'))

    await refreshEvents([calendar({ ctag: 'ctag-2', syncToken: 'token-2' })])

    expect(client.fetchEventResources).not.toHaveBeenCalled()
    expect(messageStore.messages).toHaveLength(1)
    expect(messageStore.messages[0]).toMatchObject({ title: 'Failed to load events' })
  })

  it('syncs despite an unchanged ctag after own changes (force)', async () => {
    const { refreshEvents } = await loaded()
    client.syncCollection.mockResolvedValue({ syncToken: 'token-2', changed: [], removed: [] })
    await refreshEvents([calendar()], { force: true })
    expect(client.syncCollection).toHaveBeenCalledWith(CAL, 'token-1')
  })

  it('reloads when the range changes', async () => {
    const { fetchEvents } = await loaded()
    client.fetchEventResources.mockResolvedValue([])
    await fetchEvents([calendar()], nextRange)
    expect(client.fetchEventResources).toHaveBeenCalledWith(CAL, nextRange)
  })

  it('only syncs incrementally when the same range is fetched again', async () => {
    const { fetchEvents } = await loaded()
    await fetchEvents([calendar()], range)
    expect(client.fetchEventResources).not.toHaveBeenCalled()
  })

  it('reads change markers via PROPFIND for calendars missing from discovery', async () => {
    const { fetchEvents, refreshEvents } = setup()
    const shared = calendar({ ctag: '', syncToken: undefined })
    client.fetchCollectionState.mockResolvedValue({ ctag: 'c1', syncToken: 't1' })
    client.fetchEventResources.mockResolvedValue([resource('a', 'ea')])
    await fetchEvents([shared], range)

    await refreshEvents([shared])
    expect(client.fetchCollectionState).toHaveBeenCalledTimes(2)
    expect(client.syncCollection).not.toHaveBeenCalled()
    expect(client.fetchEventResources).toHaveBeenCalledTimes(1)
  })

  it('does not request hidden calendars and drops removed calendars', async () => {
    const { events, refreshEvents } = await loaded()
    await refreshEvents([calendar({ visible: false, ctag: 'x', syncToken: 'y' })])
    expect(client.syncCollection).not.toHaveBeenCalled()
    expect(events.value).toHaveLength(2)

    await refreshEvents([])
    expect(events.value).toEqual([])
  })

  it('keeps local edits in the cache until the next sync', async () => {
    const { events, updateEventInCache, refreshEvents } = await loaded()
    const moved = {
      ...events.value.find((e) => e.uid === 'a')!,
      summary: 'moved',
      etag: 'ea2'
    } as CalendarEvent
    updateEventInCache(moved)
    expect(summaries(events.value)).toEqual(['b', 'moved'])

    // The server reports the ETag that is already cached, nothing is fetched
    client.syncCollection.mockResolvedValue({
      syncToken: 'token-2',
      changed: [{ href: `${CAL}a.ics`, etag: 'ea2' }],
      removed: []
    })
    await refreshEvents([calendar({ ctag: 'ctag-2', syncToken: 'token-2' })])
    expect(client.multigetEventResources).not.toHaveBeenCalled()
    expect(summaries(events.value)).toEqual(['b', 'moved'])
  })
})
