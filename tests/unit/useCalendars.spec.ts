import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { isEventCalendar, useCalendars } from '../../src/composables/useCalendars'
import type { Calendar } from '../../src/types/calendar'
import { createTestGettext } from './helpers/design-system'
import { resetStores } from './helpers/web-pkg'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const client = vi.hoisted(() => ({
  refreshCalendars: vi.fn(),
  listShares: vi.fn(),
  fetchCollectionState: vi.fn()
}))
vi.mock('../../src/caldav/client', () => ({ getCalDAVClient: () => client }))
vi.mock('../../src/caldav/discovery', () => ({
  discoverUserPrincipal: vi.fn().mockResolvedValue('/caldav/alice/'),
  discoverCalendarHome: vi.fn().mockResolvedValue('/caldav/alice/')
}))
vi.mock('../../src/caldav/auth', () => ({ getUserId: () => 'alice' }))

const HOME = '/caldav/alice/'

function calendar(name: string, overrides: Partial<Calendar> = {}): Calendar {
  return {
    href: `${HOME}${name}/`,
    displayName: name,
    color: '#3788d8',
    visible: true,
    ...overrides
  } as Calendar
}

function setup() {
  let result!: ReturnType<typeof useCalendars>
  mount(
    defineComponent({
      setup() {
        result = useCalendars()
        return () => h('div')
      }
    }),
    { global: { plugins: [createTestGettext('en')] } }
  )
  return result
}

describe('isEventCalendar', () => {
  it('accepts collections that hold events or advertise no component set', () => {
    expect(isEventCalendar({ components: ['VEVENT', 'VTODO'] })).toBe(true)
    expect(isEventCalendar({ components: undefined })).toBe(true)
    expect(isEventCalendar({ components: ['VTODO'] })).toBe(false)
  })
})

describe('getDefaultCalendar', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
    client.listShares.mockResolvedValue([])
    client.fetchCollectionState.mockResolvedValue({})
  })

  it('skips task-only and read-only collections', async () => {
    client.refreshCalendars.mockResolvedValue([
      calendar('tasks', { components: ['VTODO'] }),
      calendar('readonly', { components: ['VEVENT'], readOnly: true }),
      calendar('personal', { components: ['VEVENT', 'VTODO'] })
    ])
    const { loadCalendars, getDefaultCalendar } = setup()
    await loadCalendars()

    expect(getDefaultCalendar()?.displayName).toBe('personal')
  })

  it('returns nothing when no writable event calendar exists', async () => {
    client.refreshCalendars.mockResolvedValue([calendar('tasks', { components: ['VTODO'] })])
    const { loadCalendars, getDefaultCalendar } = setup()
    await loadCalendars()

    expect(getDefaultCalendar()).toBeUndefined()
  })
})
