import { getAlarmTriggerTime } from '../caldav/alarms'
import { findAttendee } from '../caldav/attendees'
import type { CalendarEvent, EventAlarm } from '../types/calendar'

/** Alarm actions that are shown in the browser; `EMAIL` alarms are left to the server */
const NOTIFY_ACTIONS = new Set(['DISPLAY', 'AUDIO'])

/** Longest delay `setTimeout` supports (about 24.8 days) */
export const MAX_TIMER_DELAY = 2 ** 31 - 1

export interface PendingAlarm {
  /** Identifies the alarm of one occurrence, used to not show it twice */
  key: string
  time: Date
  event: CalendarEvent
  alarm: EventAlarm
}

function alarmId(alarm: EventAlarm, index: number): string {
  if (alarm.absolute) return `${index}@${alarm.absolute.getTime()}`
  return `${index}:${alarm.related ?? 'START'}${alarm.offset ?? ''}`
}

/**
 * Alarms of the given events (occurrences) that trigger after `now`, ordered by time. Events the
 * user declined are skipped.
 */
export function collectPendingAlarms(
  events: readonly CalendarEvent[],
  now: number,
  userEmail?: string | null
): PendingAlarm[] {
  const pending = new Map<string, PendingAlarm>()
  for (const event of events) {
    if (!event.alarms?.length) continue
    if (findAttendee(event.attendees, userEmail)?.partstat === 'DECLINED') continue

    event.alarms.forEach((alarm, index) => {
      if (!NOTIFY_ACTIONS.has(alarm.action)) return
      const time = getAlarmTriggerTime(alarm, event)
      if (!time || time.getTime() <= now) return
      const key = `${event.href}|${event.recurrenceId ?? ''}|${alarmId(alarm, index)}|${time.getTime()}`
      if (!pending.has(key)) {
        pending.set(key, { key, time, event, alarm })
      }
    })
  }
  return [...pending.values()].sort((a, b) => a.time.getTime() - b.time.getTime())
}

/**
 * Schedules alarms with timers. `schedule` replaces all timers of the previous call (e.g. after
 * the events were reloaded); alarms that already fired are remembered and never fire again.
 */
export class AlarmScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly onFire: (alarm: PendingAlarm) => void,
    private readonly fired: Set<string> = new Set()
  ) {}

  schedule(alarms: readonly PendingAlarm[], now = Date.now()): void {
    this.clear()
    for (const alarm of alarms) {
      if (this.fired.has(alarm.key) || this.timers.has(alarm.key)) continue
      const delay = alarm.time.getTime() - now
      // Alarms further away are scheduled once the events are loaded again
      if (delay < 0 || delay > MAX_TIMER_DELAY) continue
      this.timers.set(
        alarm.key,
        setTimeout(() => {
          this.timers.delete(alarm.key)
          if (this.fired.has(alarm.key)) return
          this.fired.add(alarm.key)
          this.onFire(alarm)
        }, delay)
      )
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  get size(): number {
    return this.timers.size
  }
}
