import ICAL from 'ical.js'
import type { EventAttendee, EventOrganizer } from '../types/calendar'
import { cloneJCal } from './alarms'

/**
 * `ORGANIZER` and `ATTENDEE` properties (RFC 5545 sections 3.8.4.1 and 3.8.4.3).
 *
 * Parsed properties keep their jCal (`raw`), so parameters the app does not edit (`DELEGATED-TO`,
 * `SENT-BY`, `X-` parameters, …) are written back.
 */

/** Address of a `CAL-ADDRESS` value without the `mailto:` prefix */
export function calAddressToEmail(value: string): string {
  return value.replace(/^mailto:/i, '').trim()
}

export function emailToCalAddress(email: string): string {
  return `mailto:${email.trim()}`
}

function sameEmail(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
}

function stringParam(prop: ICAL.Property, name: string): string | undefined {
  const value = prop.getParameter(name)
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' && value ? value : undefined
}

export function parseAttendees(vevent: ICAL.Component): EventAttendee[] {
  return vevent.getAllProperties('attendee').map((prop) => {
    const cutype = stringParam(prop, 'cutype')?.toUpperCase()
    return {
      email: calAddressToEmail(String(prop.getFirstValue() ?? '')),
      ...(stringParam(prop, 'cn') && { name: stringParam(prop, 'cn') }),
      partstat: stringParam(prop, 'partstat')?.toUpperCase() || 'NEEDS-ACTION',
      role: stringParam(prop, 'role')?.toUpperCase() || 'REQ-PARTICIPANT',
      rsvp: stringParam(prop, 'rsvp')?.toUpperCase() === 'TRUE',
      ...(cutype && { cutype }),
      raw: prop.toJSON() as unknown[]
    }
  })
}

export function parseOrganizer(vevent: ICAL.Component): EventOrganizer | undefined {
  const prop = vevent.getFirstProperty('organizer')
  if (!prop) return undefined
  const name = stringParam(prop, 'cn')
  return {
    email: calAddressToEmail(String(prop.getFirstValue() ?? '')),
    ...(name && { name }),
    raw: prop.toJSON() as unknown[]
  }
}

function startProperty(name: string, email: string, raw?: unknown[]): ICAL.Property {
  if (raw) {
    const prop = new ICAL.Property(cloneJCal(raw))
    if (sameEmail(calAddressToEmail(String(prop.getFirstValue() ?? '')), email)) {
      return prop
    }
    prop.setValue(emailToCalAddress(email))
    return prop
  }
  const prop = new ICAL.Property(name)
  prop.setValue(emailToCalAddress(email))
  return prop
}

function setOptionalParam(prop: ICAL.Property, name: string, value: string | undefined) {
  if (value) {
    prop.setParameter(name, value)
  } else {
    prop.removeParameter(name)
  }
}

export function buildAttendeeProperty(attendee: EventAttendee): ICAL.Property {
  const prop = startProperty('attendee', attendee.email, attendee.raw)
  setOptionalParam(prop, 'cn', attendee.name)
  setOptionalParam(prop, 'cutype', attendee.cutype)
  prop.setParameter('role', attendee.role || 'REQ-PARTICIPANT')
  prop.setParameter('partstat', attendee.partstat || 'NEEDS-ACTION')
  prop.setParameter('rsvp', attendee.rsvp ? 'TRUE' : 'FALSE')
  return prop
}

export function buildOrganizerProperty(organizer: EventOrganizer): ICAL.Property {
  const prop = startProperty('organizer', organizer.email, organizer.raw)
  setOptionalParam(prop, 'cn', organizer.name)
  return prop
}

/** Replaces `ORGANIZER` and all `ATTENDEE`s of the component */
export function writeParticipants(
  vevent: ICAL.Component,
  attendees: EventAttendee[],
  organizer: EventOrganizer | undefined
): void {
  vevent.removeAllProperties('organizer')
  vevent.removeAllProperties('attendee')
  // RFC 5545: ORGANIZER is required when there are attendees (group scheduled event)
  if (organizer?.email) {
    vevent.addProperty(buildOrganizerProperty(organizer))
  }
  for (const attendee of attendees) {
    if (attendee.email) {
      vevent.addProperty(buildAttendeeProperty(attendee))
    }
  }
}

/** Attendee entry of the given user (matched by mail), if any */
export function findAttendee(
  attendees: readonly EventAttendee[] | undefined,
  email: string | null | undefined
): EventAttendee | undefined {
  if (!email || !attendees) return undefined
  return attendees.find((a) => sameEmail(a.email, email))
}

export function isOrganizer(
  organizer: EventOrganizer | undefined,
  email: string | null | undefined
) {
  return !!organizer && sameEmail(organizer.email, email ?? undefined)
}

/** Returns a copy of the attendees with the participation status of the given user changed */
export function setParticipationStatus(
  attendees: readonly EventAttendee[],
  email: string,
  partstat: string
): EventAttendee[] {
  return attendees.map((a) => (sameEmail(a.email, email) ? { ...a, partstat } : { ...a }))
}

/**
 * Turns an event into an iTIP request (RFC 5546) that can be sent to attendees by other means,
 * e.g. attached to an email: adds `METHOD:REQUEST` to the calendar object.
 */
export function toInvitationICS(icsData: string): string {
  const calendar = new ICAL.Component(ICAL.parse(icsData))
  calendar.removeAllProperties('method')
  calendar.addPropertyWithValue('method', 'REQUEST')
  return calendar.toString()
}
