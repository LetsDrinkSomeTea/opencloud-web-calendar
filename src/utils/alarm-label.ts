import type { Language } from 'vue3-gettext'
import type { EventAlarm } from '../types/calendar'

type Translate = Pick<Language, '$gettext' | '$ngettext'>

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export type AlarmUnit = 'minutes' | 'hours' | 'days' | 'weeks'

export const ALARM_UNIT_SECONDS: Record<AlarmUnit, number> = {
  minutes: MINUTE,
  hours: HOUR,
  days: DAY,
  weeks: WEEK
}

/** Reminder presets: seconds relative to the start of the event */
export const TIMED_ALARM_PRESETS = [
  0,
  -5 * MINUTE,
  -10 * MINUTE,
  -15 * MINUTE,
  -30 * MINUTE,
  -HOUR,
  -DAY,
  -WEEK
]
/** All-day events start at midnight: on the day at 09:00 and the day before at 09:00 */
export const ALL_DAY_ALARM_PRESETS = [9 * HOUR, 9 * HOUR - DAY]

function formatClock(seconds: number): string {
  const hours = Math.floor(seconds / HOUR)
  const minutes = Math.floor((seconds % HOUR) / MINUTE)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** "15 minutes", "2 hours", … for an amount of seconds */
export function formatAlarmDuration(seconds: number, { $ngettext }: Translate): string {
  const abs = Math.abs(seconds)
  if (abs > 0 && abs % WEEK === 0) {
    const n = abs / WEEK
    return $ngettext('%{n} week', '%{n} weeks', n, { n: String(n) })
  }
  if (abs > 0 && abs % DAY === 0) {
    const n = abs / DAY
    return $ngettext('%{n} day', '%{n} days', n, { n: String(n) })
  }
  if (abs > 0 && abs % HOUR === 0) {
    const n = abs / HOUR
    return $ngettext('%{n} hour', '%{n} hours', n, { n: String(n) })
  }
  const n = Math.round(abs / MINUTE)
  return $ngettext('%{n} minute', '%{n} minutes', n, { n: String(n) })
}

function describeTiming(
  alarm: EventAlarm,
  allDay: boolean,
  translate: Translate,
  formatDate: (date: Date) => string
): string {
  const { $gettext, $ngettext } = translate
  if (alarm.absolute) {
    return $gettext('On %{date}', { date: formatDate(alarm.absolute) })
  }
  const offset = alarm.offset ?? 0
  const related = alarm.related ?? 'START'

  if (allDay && related === 'START') {
    // Relative to midnight of the day of the event
    const days = Math.floor(offset / DAY)
    const time = formatClock(offset - days * DAY)
    if (days === 0) {
      return $gettext('On the day at %{time}', { time })
    }
    const n = Math.abs(days)
    return days < 0
      ? $ngettext('%{n} day before at %{time}', '%{n} days before at %{time}', n, {
          n: String(n),
          time
        })
      : $ngettext('%{n} day after at %{time}', '%{n} days after at %{time}', n, {
          n: String(n),
          time
        })
  }

  if (offset === 0) {
    return related === 'END' ? $gettext('At end of event') : $gettext('At start of event')
  }
  const duration = formatAlarmDuration(offset, translate)
  if (related === 'END') {
    return offset < 0
      ? $gettext('%{duration} before the end', { duration })
      : $gettext('%{duration} after the end', { duration })
  }
  return offset < 0
    ? $gettext('%{duration} before', { duration })
    : $gettext('%{duration} after the start', { duration })
}

/** User facing description of a reminder, e.g. "15 minutes before" or "1 hour before (email)" */
export function describeAlarm(
  alarm: EventAlarm,
  allDay: boolean,
  translate: Translate,
  formatDate: (date: Date) => string = (date) => date.toLocaleString()
): string {
  const when = describeTiming(alarm, allDay, translate, formatDate)
  switch (alarm.action) {
    case 'DISPLAY':
      return when
    case 'EMAIL':
      return translate.$gettext('%{when} (email)', { when })
    case 'AUDIO':
      return translate.$gettext('%{when} (sound)', { when })
    default:
      return `${when} (${alarm.action.toLowerCase()})`
  }
}
