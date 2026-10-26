import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import FreeBusyHint from '../../src/components/FreeBusyHint.vue'
import { useFreeBusy } from '../../src/composables/useFreeBusy'
import type { BusyPeriod } from '../../src/caldav/freebusy'
import type { Calendar } from '../../src/types/calendar'
import { globalMountOptions } from './helpers/design-system'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const queryFreeBusy = vi.hoisted(() => vi.fn())
vi.mock('../../src/caldav/client', () => ({ getCalDAVClient: () => ({ queryFreeBusy }) }))

const at = (time: string) => new Date(`2026-10-27T${time}:00Z`)

function busy(start: string, end: string, calendarHref = '/caldav/alice/a/'): BusyPeriod {
  return { start: at(start), end: at(end), type: 'BUSY', calendarHref }
}

function calendar(href: string, visible = true): Calendar {
  return { href, displayName: href, color: '#000', ctag: '', visible }
}

beforeEach(() => {
  queryFreeBusy.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useFreeBusy', () => {
  it('reports busy periods overlapping the time and queries with padding', async () => {
    queryFreeBusy.mockResolvedValue([busy('09:00', '10:00'), busy('10:30', '11:30')])
    const { conflicts, check } = useFreeBusy()

    await check({ calendarHrefs: ['/caldav/alice/a/'], start: at('10:00'), end: at('11:00') })

    expect(conflicts.value).toHaveLength(1)
    const [hrefs, range] = queryFreeBusy.mock.calls[0]
    expect(hrefs).toEqual(['/caldav/alice/a/'])
    expect(range.start.getTime()).toBeLessThan(at('10:00').getTime())
    expect(range.end.getTime()).toBeGreaterThan(at('11:00').getTime())
  })

  it('ignores the busy period of the edited event itself once', async () => {
    queryFreeBusy.mockResolvedValue([busy('10:00', '11:00'), busy('10:00', '11:00')])
    const { conflicts, check } = useFreeBusy()

    await check({
      calendarHrefs: ['/caldav/alice/a/'],
      start: at('10:30'),
      end: at('11:30'),
      ignore: { start: at('10:00'), end: at('11:00') }
    })

    // The second, identical period belongs to another event
    expect(conflicts.value).toHaveLength(1)
  })

  it('applies only the latest check', async () => {
    let resolveFirst!: (periods: BusyPeriod[]) => void
    queryFreeBusy
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([])
    const { conflicts, check } = useFreeBusy()

    const first = check({ calendarHrefs: ['/a/'], start: at('10:00'), end: at('11:00') })
    await check({ calendarHrefs: ['/a/'], start: at('12:00'), end: at('13:00') })
    resolveFirst([busy('10:00', '11:00')])
    await first

    expect(conflicts.value).toEqual([])
  })

  it('shows no conflicts when the lookup fails', async () => {
    queryFreeBusy.mockRejectedValue(new Error('offline'))
    const { conflicts, error, check } = useFreeBusy()
    await check({ calendarHrefs: ['/a/'], start: at('10:00'), end: at('11:00') })
    expect(conflicts.value).toEqual([])
    expect(error.value).toBeInstanceOf(Error)
  })

  it('does not query without calendars', async () => {
    const { check } = useFreeBusy()
    await check({ calendarHrefs: [], start: at('10:00'), end: at('11:00') })
    expect(queryFreeBusy).not.toHaveBeenCalled()
  })
})

describe('FreeBusyHint', () => {
  function mountHint(props: Partial<InstanceType<typeof FreeBusyHint>['$props']> = {}) {
    return mount(FreeBusyHint, {
      props: {
        calendars: [calendar('/caldav/alice/a/'), calendar('/caldav/alice/hidden/', false)],
        start: at('10:00'),
        end: at('11:00'),
        allDay: false,
        ...props
      },
      ...globalMountOptions()
    })
  }

  it('shows a hint for busy time in visible calendars after a short delay', async () => {
    vi.useFakeTimers()
    queryFreeBusy.mockResolvedValue([busy('10:30', '11:30')])
    const wrapper = mountHint()

    expect(queryFreeBusy).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(queryFreeBusy.mock.calls[0][0]).toEqual(['/caldav/alice/a/'])
    expect(wrapper.find('[role="status"]').text()).toContain(
      'This time overlaps with 1 busy period in your calendars.'
    )
  })

  it('shows nothing when the time is free', async () => {
    vi.useFakeTimers()
    queryFreeBusy.mockResolvedValue([])
    const wrapper = mountHint()
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('does not check all-day events', async () => {
    vi.useFakeTimers()
    mountHint({ allDay: true })
    await vi.runAllTimersAsync()
    expect(queryFreeBusy).not.toHaveBeenCalled()
  })
})
