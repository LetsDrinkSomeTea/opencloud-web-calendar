import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AlarmScheduler, collectPendingAlarms } from '../../src/utils/alarm-scheduler'
import type { CalendarEvent, EventAlarm } from '../../src/types/calendar'

const NOW = new Date('2026-10-26T08:00:00Z').getTime()

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: 'uid',
    calendarHref: '/caldav/cal/',
    href: '/caldav/cal/uid.ics',
    etag: 'e',
    summary: 'Meeting',
    start: new Date('2026-10-26T09:00:00Z'),
    end: new Date('2026-10-26T10:00:00Z'),
    allDay: false,
    icsData: '',
    isRecurring: false,
    alarms: [{ action: 'DISPLAY', offset: -900, related: 'START' }],
    ...overrides
  }
}

describe('collectPendingAlarms', () => {
  it('returns future DISPLAY and AUDIO alarms ordered by time', () => {
    const alarms: EventAlarm[] = [
      { action: 'DISPLAY', offset: -900, related: 'START' },
      { action: 'EMAIL', offset: -1200, related: 'START' },
      { action: 'AUDIO', offset: -1800, related: 'START' },
      // already in the past
      { action: 'DISPLAY', offset: -7200, related: 'START' }
    ]
    const pending = collectPendingAlarms([event({ alarms })], NOW)
    expect(pending.map((p) => p.time.toISOString())).toEqual([
      '2026-10-26T08:30:00.000Z',
      '2026-10-26T08:45:00.000Z'
    ])
  })

  it('includes every occurrence of recurring events', () => {
    const occurrences = [26, 27, 28].map((day) =>
      event({
        isRecurring: true,
        recurrenceId: `2026-10-${day}T09:00:00Z`,
        start: new Date(`2026-10-${day}T09:00:00Z`),
        end: new Date(`2026-10-${day}T10:00:00Z`)
      })
    )
    const pending = collectPendingAlarms(occurrences, NOW)
    expect(pending).toHaveLength(3)
    expect(new Set(pending.map((p) => p.key)).size).toBe(3)
  })

  it('skips events the user declined', () => {
    const declined = event({
      attendees: [
        { email: 'me@example.org', partstat: 'DECLINED', role: 'REQ-PARTICIPANT', rsvp: false }
      ]
    })
    expect(collectPendingAlarms([declined], NOW, 'ME@example.org')).toEqual([])
    expect(collectPendingAlarms([declined], NOW, 'other@example.org')).toHaveLength(1)
  })

  it('reports an absolute alarm of a series only once', () => {
    const alarms: EventAlarm[] = [{ action: 'DISPLAY', absolute: new Date('2026-10-26T08:30:00Z') }]
    const occurrences = [26, 27].map((day) =>
      event({
        alarms,
        recurrenceId: `2026-10-${day}T09:00:00Z`,
        start: new Date(`2026-10-${day}T09:00:00Z`)
      })
    )
    // Different occurrences have different keys, but each is collected only once per occurrence
    expect(collectPendingAlarms(occurrences, NOW)).toHaveLength(2)
    expect(collectPendingAlarms([occurrences[0], occurrences[0]], NOW)).toHaveLength(1)
  })
})

describe('AlarmScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires alarms at their trigger time', () => {
    const onFire = vi.fn()
    const scheduler = new AlarmScheduler(onFire)
    scheduler.schedule(collectPendingAlarms([event()], Date.now()))

    vi.advanceTimersByTime(45 * 60 * 1000 - 1)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire.mock.calls[0][0].event.summary).toBe('Meeting')
    expect(scheduler.size).toBe(0)
  })

  it('does not fire twice when the events are reloaded', () => {
    const onFire = vi.fn()
    const scheduler = new AlarmScheduler(onFire)
    const events = [event()]
    scheduler.schedule(collectPendingAlarms(events, Date.now()))
    // reloaded before the alarm is due: timers are replaced, not added
    scheduler.schedule(collectPendingAlarms(events, Date.now()))
    expect(scheduler.size).toBe(1)

    vi.advanceTimersByTime(45 * 60 * 1000)
    expect(onFire).toHaveBeenCalledTimes(1)

    // reloaded with a clock that is behind: the fired alarm is remembered
    scheduler.schedule(collectPendingAlarms(events, NOW))
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('shares fired alarms between schedulers (e.g. after remounting)', () => {
    const fired = new Set<string>()
    const first = vi.fn()
    new AlarmScheduler(first, fired).schedule(collectPendingAlarms([event()], Date.now()))
    vi.advanceTimersByTime(45 * 60 * 1000)

    const second = vi.fn()
    new AlarmScheduler(second, fired).schedule(collectPendingAlarms([event()], NOW))
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('cancels removed alarms on reload and all alarms on clear', () => {
    const onFire = vi.fn()
    const scheduler = new AlarmScheduler(onFire)
    scheduler.schedule(collectPendingAlarms([event()], Date.now()))
    scheduler.schedule(collectPendingAlarms([event({ alarms: [] })], Date.now()))
    expect(scheduler.size).toBe(0)

    scheduler.schedule(collectPendingAlarms([event()], Date.now()))
    scheduler.clear()
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('reschedules moved events', () => {
    const onFire = vi.fn()
    const scheduler = new AlarmScheduler(onFire)
    scheduler.schedule(collectPendingAlarms([event()], Date.now()))
    const moved = event({
      start: new Date('2026-10-26T12:00:00Z'),
      end: new Date('2026-10-26T13:00:00Z')
    })
    scheduler.schedule(collectPendingAlarms([moved], Date.now()))

    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3 * 60 * 60 * 1000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('ignores alarms beyond the longest timer delay', () => {
    const scheduler = new AlarmScheduler(vi.fn())
    const far = event({
      start: new Date('2027-01-26T09:00:00Z'),
      end: new Date('2027-01-26T10:00:00Z')
    })
    scheduler.schedule(collectPendingAlarms([far], Date.now()))
    expect(scheduler.size).toBe(0)
  })
})
