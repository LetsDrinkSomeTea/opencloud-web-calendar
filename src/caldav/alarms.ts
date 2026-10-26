import ICAL from 'ical.js'
import type { CalendarEvent, EventAlarm } from '../types/calendar'

/**
 * Reminders (`VALARM`, RFC 5545 section 3.6.6).
 *
 * Alarms parsed from the server keep their component (`raw`) and are written back unchanged, so
 * properties the app does not edit (attachments, repeat, `X-` properties, `ACKNOWLEDGED`, …) and
 * alarms the app cannot edit (e.g. `EMAIL`) survive a round-trip. New alarms are written as
 * `ACTION:DISPLAY` with a `DESCRIPTION`.
 */

export function parseAlarms(vevent: ICAL.Component): EventAlarm[] {
  const alarms: EventAlarm[] = []
  for (const valarm of vevent.getAllSubcomponents('valarm')) {
    const alarm = parseAlarm(valarm)
    if (alarm) alarms.push(alarm)
  }
  return alarms
}

function parseAlarm(valarm: ICAL.Component): EventAlarm | null {
  const trigger = valarm.getFirstProperty('trigger')
  const action = String(valarm.getFirstPropertyValue('action') || 'DISPLAY').toUpperCase()
  const description = valarm.getFirstPropertyValue('description')
  const alarm: EventAlarm = {
    action,
    ...(typeof description === 'string' && description && { description }),
    raw: valarm.toJSON() as unknown[]
  }
  if (!trigger) {
    return alarm
  }

  const value = trigger.getFirstValue()
  if (value instanceof ICAL.Time) {
    alarm.absolute = value.toJSDate()
  } else if (value instanceof ICAL.Duration) {
    alarm.offset = value.toSeconds()
    const related = trigger.getParameter('related')
    alarm.related = typeof related === 'string' && related.toUpperCase() === 'END' ? 'END' : 'START'
  }
  return alarm
}

export function buildAlarmComponent(alarm: EventAlarm, summary: string): ICAL.Component {
  if (alarm.raw) {
    return new ICAL.Component(cloneJCal(alarm.raw))
  }

  const valarm = new ICAL.Component('valarm')
  valarm.addPropertyWithValue('action', alarm.action || 'DISPLAY')

  const trigger = new ICAL.Property('trigger')
  if (alarm.absolute) {
    trigger.resetType('date-time')
    trigger.setValue(ICAL.Time.fromJSDate(alarm.absolute, true))
  } else {
    trigger.setValue(ICAL.Duration.fromSeconds(alarm.offset ?? 0))
    if (alarm.related === 'END') {
      trigger.setParameter('related', 'END')
    }
  }
  valarm.addProperty(trigger)

  // DESCRIPTION is required for DISPLAY (and EMAIL) alarms
  valarm.addPropertyWithValue('description', alarm.description || summary || 'Reminder')
  return valarm
}

/** Replaces all `VALARM`s of the component */
export function writeAlarms(vevent: ICAL.Component, alarms: EventAlarm[], summary: string): void {
  vevent.removeAllSubcomponents('valarm')
  for (const alarm of alarms) {
    vevent.addSubcomponent(buildAlarmComponent(alarm, summary))
  }
}

/**
 * Point in time an alarm fires for the given event (occurrence), or null if the alarm has no
 * trigger.
 */
export function getAlarmTriggerTime(
  alarm: EventAlarm,
  event: Pick<CalendarEvent, 'start' | 'end'>
): Date | null {
  if (alarm.absolute) {
    return new Date(alarm.absolute)
  }
  if (alarm.offset === undefined) {
    return null
  }
  const base = alarm.related === 'END' ? event.end : event.start
  return new Date(base.getTime() + alarm.offset * 1000)
}

/**
 * Deep copy of a jCal value. The value may be wrapped in a Vue proxy (form data), which
 * `structuredClone` refuses.
 */
export function cloneJCal(value: unknown[]): unknown[] {
  return JSON.parse(JSON.stringify(value)) as unknown[]
}

/** Whether two alarms trigger at the same relative time */
export function isSameRelativeAlarm(a: EventAlarm, b: EventAlarm): boolean {
  return (
    !a.absolute &&
    !b.absolute &&
    a.offset === b.offset &&
    (a.related ?? 'START') === (b.related ?? 'START') &&
    a.action === b.action
  )
}
