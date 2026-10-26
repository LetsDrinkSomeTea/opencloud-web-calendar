export interface Calendar {
  href: string
  displayName: string
  color: string
  ctag: string
  description?: string
  visible: boolean
  readOnly?: boolean
  isShared?: boolean
  owner?: string
  sharePathOrToken?: string
  /** Supported component types (VEVENT, VTODO, …); undefined means all (RFC 4791 5.2.3) */
  components?: readonly string[]
}

export interface CalendarEvent {
  uid: string
  calendarHref: string
  href: string
  etag: string
  summary: string
  start: Date
  end: Date
  allDay: boolean
  description?: string
  location?: string
  icsData: string
  rrule?: string
  recurrenceId?: string
  isRecurring: boolean
  alarms?: EventAlarm[]
  attendees?: EventAttendee[]
  organizer?: EventOrganizer
}

/**
 * A reminder (`VALARM`). Either `offset` (relative to the start or end of the event) or
 * `absolute` is set.
 */
export interface EventAlarm {
  /** `DISPLAY`, `AUDIO`, `EMAIL` or any other action */
  action: string
  /** Seconds relative to the start (or end, see `related`); negative values are before */
  offset?: number
  related?: 'START' | 'END'
  absolute?: Date
  description?: string
  /** The parsed component as jCal; written back unchanged so unknown properties are kept */
  raw?: unknown[]
}

export type ParticipationStatus =
  | 'NEEDS-ACTION'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'TENTATIVE'
  | 'DELEGATED'

export interface EventAttendee {
  /** Address without the `mailto:` prefix */
  email: string
  name?: string
  /** `PARTSTAT`, one of `ParticipationStatus` or another value sent by a client */
  partstat: string
  /** `ROLE`, e.g. `REQ-PARTICIPANT`, `OPT-PARTICIPANT`, `CHAIR` */
  role: string
  rsvp: boolean
  /** `CUTYPE`, e.g. `INDIVIDUAL`, `ROOM` */
  cutype?: string
  /** The parsed property as jCal, so unknown parameters are kept */
  raw?: unknown[]
}

export interface EventOrganizer {
  email: string
  name?: string
  raw?: unknown[]
}

export interface RecurrenceFormData {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  endType: 'never' | 'count' | 'until'
  count?: number
  until?: Date
  byDay?: string[]
}

export interface EventFormData {
  uid?: string
  calendarHref: string
  summary: string
  start: Date
  end: Date
  allDay: boolean
  description: string
  location: string
  recurrence?: RecurrenceFormData
  /** Reminders; when undefined the reminders of the event being replaced are kept */
  alarms?: EventAlarm[]
  /** Attendees; when undefined the attendees (and organizer) of the event are kept */
  attendees?: EventAttendee[]
  organizer?: EventOrganizer
}

export interface DateRange {
  start: Date
  end: Date
}
