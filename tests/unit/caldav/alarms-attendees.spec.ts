import ICAL from 'ical.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  addExceptionToICS,
  generateICS,
  parseICS,
  updateSeriesICS
} from '../../../src/caldav/ics-utils'
import { getAlarmTriggerTime } from '../../../src/caldav/alarms'
import {
  findAttendee,
  setParticipationStatus,
  toInvitationICS
} from '../../../src/caldav/attendees'
import type { EventFormData } from '../../../src/types/calendar'

const HREF = '/caldav/calendars/user/personal/event.ics'
const originalTZ = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'Europe/Berlin'
})

afterAll(() => {
  process.env.TZ = originalTZ
})

const EVENT = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:alarm-event',
  'DTSTAMP:20261001T000000Z',
  'DTSTART:20261026T090000Z',
  'DTEND:20261026T100000Z',
  'SUMMARY:Planning',
  'ORGANIZER;CN=Alice:mailto:alice@example.org',
  'ATTENDEE;CN=Bob;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CUTYPE=INDIVIDUAL;X-FOO=bar:mailto:bob@example.org',
  'ATTENDEE;PARTSTAT=ACCEPTED;ROLE=OPT-PARTICIPANT:mailto:carol@example.org',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Planning soon',
  'TRIGGER:-PT15M',
  'X-WR-ALARMUID:abc-123',
  'END:VALARM',
  'BEGIN:VALARM',
  'ACTION:EMAIL',
  'SUMMARY:Mail',
  'DESCRIPTION:Mail body',
  'ATTENDEE:mailto:bob@example.org',
  'TRIGGER;RELATED=END:PT5M',
  'END:VALARM',
  'BEGIN:VALARM',
  'ACTION:AUDIO',
  'TRIGGER;VALUE=DATE-TIME:20261026T083000Z',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const RECURRING = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:recurring-alarm',
  'DTSTAMP:20261001T000000Z',
  'DTSTART:20261026T090000Z',
  'DTEND:20261026T100000Z',
  'RRULE:FREQ=DAILY;COUNT=3',
  'SUMMARY:Standup',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Standup',
  'TRIGGER:-PT10M',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:recurring-alarm',
  'DTSTAMP:20261001T000000Z',
  'RECURRENCE-ID:20261027T090000Z',
  'DTSTART:20261027T110000Z',
  'DTEND:20261027T120000Z',
  'SUMMARY:Standup (moved)',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Moved',
  'TRIGGER:-PT1H',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

function formData(overrides: Partial<EventFormData> = {}): EventFormData {
  return {
    uid: 'alarm-event',
    calendarHref: '/caldav/calendars/user/personal/',
    summary: 'Planning',
    start: new Date('2026-10-26T09:00:00Z'),
    end: new Date('2026-10-26T10:00:00Z'),
    allDay: false,
    description: '',
    location: '',
    ...overrides
  }
}

function vevents(ics: string): ICAL.Component[] {
  return new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent')
}

describe('VALARM', () => {
  it('parses relative, end-related and absolute triggers', () => {
    const [event] = parseICS(EVENT, HREF, 'etag')
    expect(event.alarms).toHaveLength(3)
    const [display, email, audio] = event.alarms

    expect(display).toMatchObject({
      action: 'DISPLAY',
      offset: -900,
      related: 'START',
      description: 'Planning soon'
    })
    expect(getAlarmTriggerTime(display, event)?.toISOString()).toBe('2026-10-26T08:45:00.000Z')

    expect(email).toMatchObject({ action: 'EMAIL', offset: 300, related: 'END' })
    expect(getAlarmTriggerTime(email, event)?.toISOString()).toBe('2026-10-26T10:05:00.000Z')

    expect(audio.action).toBe('AUDIO')
    expect(audio.absolute?.toISOString()).toBe('2026-10-26T08:30:00.000Z')
    expect(getAlarmTriggerTime(audio, event)?.toISOString()).toBe('2026-10-26T08:30:00.000Z')
  })

  it('keeps alarms including unknown properties on round-trip', () => {
    const [event] = parseICS(EVENT, HREF, 'etag')
    const ics = generateICS(formData({ alarms: event.alarms }), { sourceICS: EVENT })

    const [vevent] = vevents(ics)
    const valarms = vevent.getAllSubcomponents('valarm')
    expect(valarms).toHaveLength(3)
    expect(valarms[0].getFirstPropertyValue('x-wr-alarmuid')).toBe('abc-123')
    expect(valarms[1].getFirstPropertyValue('action')).toBe('EMAIL')
    expect(valarms[1].getFirstPropertyValue('attendee')).toBe('mailto:bob@example.org')
    expect(valarms[2].getFirstProperty('trigger').type).toBe('date-time')

    const [reparsed] = parseICS(ics, HREF, 'etag')
    expect(reparsed.alarms.map(({ raw: _raw, ...alarm }) => alarm)).toEqual(
      event.alarms.map(({ raw: _raw, ...alarm }) => alarm)
    )
  })

  it('keeps alarms when the form does not provide them (e.g. drag and drop)', () => {
    const ics = generateICS(formData({ start: new Date('2026-10-27T09:00:00Z') }), {
      sourceICS: EVENT
    })
    expect(vevents(ics)[0].getAllSubcomponents('valarm')).toHaveLength(3)
  })

  it('writes new alarms as DISPLAY with a description and removes deleted ones', () => {
    const [event] = parseICS(EVENT, HREF, 'etag')
    const ics = generateICS(
      formData({
        alarms: [event.alarms[1], { action: 'DISPLAY', offset: -3600, related: 'START' }]
      }),
      { sourceICS: EVENT }
    )
    const valarms = vevents(ics)[0].getAllSubcomponents('valarm')
    expect(valarms).toHaveLength(2)
    expect(valarms[0].getFirstPropertyValue('action')).toBe('EMAIL')
    expect(valarms[1].getFirstPropertyValue('action')).toBe('DISPLAY')
    expect(valarms[1].getFirstPropertyValue('description')).toBe('Planning')
    expect(valarms[1].getFirstPropertyValue('trigger').toString()).toBe('-PT1H')
    expect(ics).toContain('TRIGGER:-PT1H')
  })

  it('writes end-related and absolute triggers', () => {
    const ics = generateICS(
      formData({
        alarms: [
          { action: 'DISPLAY', offset: -300, related: 'END' },
          { action: 'DISPLAY', absolute: new Date('2026-10-25T18:00:00Z') }
        ]
      })
    )
    expect(ics).toContain('TRIGGER;RELATED=END:-PT5M')
    expect(ics).toContain('TRIGGER;VALUE=DATE-TIME:20261025T180000Z')
  })

  it('expands alarms to the occurrences of recurring events, exceptions use their own', () => {
    const occurrences = parseICS(RECURRING, HREF, 'etag', {
      start: new Date('2026-10-01T00:00:00Z'),
      end: new Date('2026-11-01T00:00:00Z')
    })
    expect(occurrences).toHaveLength(3)
    const triggers = occurrences.map((o) => getAlarmTriggerTime(o.alarms[0], o)?.toISOString())
    expect(triggers).toEqual([
      '2026-10-26T08:50:00.000Z',
      '2026-10-27T10:00:00.000Z',
      '2026-10-28T08:50:00.000Z'
    ])
  })

  it('updates the alarms of a series and keeps those of exceptions', () => {
    const ics = updateSeriesICS(
      RECURRING,
      formData({
        uid: 'recurring-alarm',
        summary: 'Standup',
        recurrence: { frequency: 'DAILY', interval: 1, endType: 'count', count: 3 },
        alarms: [{ action: 'DISPLAY', offset: 0, related: 'START' }]
      })
    )
    const [master, exception] = vevents(ics)
    expect(master.getAllSubcomponents('valarm')).toHaveLength(1)
    expect(master.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString()).toBe(
      'PT0S'
    )
    expect(exception.getFirstSubcomponent('valarm').getFirstPropertyValue('description')).toBe(
      'Moved'
    )
  })

  it('copies the alarms of the series into a new exception', () => {
    const ics = addExceptionToICS(
      RECURRING,
      '2026-10-28T09:00:00Z',
      formData({
        uid: 'recurring-alarm',
        summary: 'Standup',
        start: new Date('2026-10-28T12:00:00Z'),
        end: new Date('2026-10-28T13:00:00Z')
      })
    )
    const exception = vevents(ics).find(
      (v) => v.getFirstPropertyValue('recurrence-id')?.toString() === '2026-10-28T09:00:00Z'
    )
    expect(
      exception.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString()
    ).toBe('-PT10M')
  })
})

describe('ATTENDEE and ORGANIZER', () => {
  it('parses organizer and attendees with their parameters', () => {
    const [event] = parseICS(EVENT, HREF, 'etag')
    expect(event.organizer).toMatchObject({ email: 'alice@example.org', name: 'Alice' })
    expect(event.attendees.map(({ raw: _raw, ...a }) => a)).toEqual([
      {
        email: 'bob@example.org',
        name: 'Bob',
        partstat: 'NEEDS-ACTION',
        role: 'REQ-PARTICIPANT',
        rsvp: true,
        cutype: 'INDIVIDUAL'
      },
      {
        email: 'carol@example.org',
        partstat: 'ACCEPTED',
        role: 'OPT-PARTICIPANT',
        rsvp: false
      }
    ])
  })

  it('writes attendees back with unknown parameters and updated PARTSTAT', () => {
    const [event] = parseICS(EVENT, HREF, 'etag')
    const attendees = setParticipationStatus(event.attendees, 'BOB@example.org', 'ACCEPTED')
    expect(findAttendee(attendees, 'bob@example.org')?.partstat).toBe('ACCEPTED')
    // The original is not changed
    expect(event.attendees[0].partstat).toBe('NEEDS-ACTION')

    const ics = generateICS(formData({ attendees, organizer: event.organizer }), {
      sourceICS: EVENT
    })
    const [vevent] = vevents(ics)
    const [bob, carol] = vevent.getAllProperties('attendee')
    expect(bob.getFirstValue()).toBe('mailto:bob@example.org')
    expect(bob.getParameter('partstat')).toBe('ACCEPTED')
    expect(bob.getParameter('cn')).toBe('Bob')
    expect(bob.getParameter('x-foo')).toBe('bar')
    expect(carol.getParameter('role')).toBe('OPT-PARTICIPANT')
    expect(vevent.getFirstPropertyValue('organizer')).toBe('mailto:alice@example.org')
    expect(vevent.getFirstProperty('organizer').getParameter('cn')).toBe('Alice')
  })

  it('writes new attendees and the organizer', () => {
    const ics = generateICS(
      formData({
        organizer: { email: 'me@example.org', name: 'Me' },
        attendees: [
          {
            email: 'dave@example.org',
            name: 'Dave',
            partstat: 'NEEDS-ACTION',
            role: 'REQ-PARTICIPANT',
            rsvp: true,
            cutype: 'INDIVIDUAL'
          }
        ]
      })
    )
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('ORGANIZER;CN=Me:mailto:me@example.org')
    expect(unfolded).toMatch(
      /ATTENDEE;[^\r\n]*PARTSTAT=NEEDS-ACTION[^\r\n]*:mailto:dave@example.org/
    )
    expect(unfolded).toMatch(/ATTENDEE;[^\r\n]*RSVP=TRUE/)
    expect(unfolded).toMatch(/ATTENDEE;[^\r\n]*CN=Dave/)
  })

  it('removes the organizer together with the last attendee', () => {
    const [event] = parseICS(EVENT, HREF, 'etag')
    const ics = generateICS(formData({ attendees: [], organizer: event.organizer }), {
      sourceICS: EVENT
    })
    const [vevent] = vevents(ics)
    expect(vevent.getAllProperties('attendee')).toEqual([])
    expect(vevent.getFirstProperty('organizer')).toBeNull()
  })

  it('keeps attendees when the form does not provide them', () => {
    const ics = generateICS(formData(), { sourceICS: EVENT })
    const [vevent] = vevents(ics)
    expect(vevent.getAllProperties('attendee')).toHaveLength(2)
    expect(vevent.getFirstPropertyValue('organizer')).toBe('mailto:alice@example.org')
  })

  it('updates the PARTSTAT of a single occurrence in an exception', () => {
    const occurrences = parseICS(
      RECURRING.replace(
        'SUMMARY:Standup\r\n',
        'SUMMARY:Standup\r\nORGANIZER:mailto:alice@example.org\r\nATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:bob@example.org\r\n'
      ),
      HREF,
      'etag'
    )
    const third = occurrences[2]
    expect(third.attendees).toHaveLength(1)
    const ics = addExceptionToICS(
      third.icsData,
      third.recurrenceId,
      formData({
        uid: third.uid,
        summary: third.summary,
        start: third.start,
        end: third.end,
        attendees: setParticipationStatus(third.attendees, 'bob@example.org', 'DECLINED'),
        organizer: third.organizer
      })
    )
    const [master, , exception] = vevents(ics)
    expect(master.getFirstProperty('attendee').getParameter('partstat')).toBe('NEEDS-ACTION')
    expect(exception.getFirstProperty('attendee').getParameter('partstat')).toBe('DECLINED')
  })

  it('creates an invitation with METHOD:REQUEST', () => {
    const invitation = toInvitationICS(EVENT)
    expect(new ICAL.Component(ICAL.parse(invitation)).getFirstPropertyValue('method')).toBe(
      'REQUEST'
    )
  })
})
