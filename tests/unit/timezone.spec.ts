import ICAL from 'ical.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  addExceptionToICS,
  generateICS,
  parseICS,
  updateSeriesICS
} from '../../src/caldav/ics-utils'
import { parseICSFile } from '../../src/caldav/ics-import'
import { buildVTimezone, getLocalTimezone, getTimezoneOffset } from '../../src/caldav/timezone'
import type { EventFormData } from '../../src/types/calendar'

const HREF = '/caldav/calendars/user/personal/event.ics'
const originalTZ = process.env.TZ

beforeAll(() => {
  // the "browser" zone used for new events
  process.env.TZ = 'Europe/Berlin'
})

afterAll(() => {
  process.env.TZ = originalTZ
})

function formData(overrides: Partial<EventFormData>): EventFormData {
  return {
    uid: 'test-uid@opencloud',
    calendarHref: '/caldav/calendars/user/personal/',
    summary: 'Weekly meeting',
    start: new Date('2026-03-16T09:00:00Z'),
    end: new Date('2026-03-16T10:00:00Z'),
    allDay: false,
    description: '',
    location: '',
    ...overrides
  }
}

function utcHours(dates: Date[]): number[] {
  return dates.map((d) => d.getUTCHours())
}

/** Wall clock time of an instant in a zone, e.g. 10:00 */
function wallClock(date: Date, tzid: string): string {
  return date.toLocaleTimeString('en-GB', { timeZone: tzid, hour: '2-digit', minute: '2-digit' })
}

const range = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) })

describe('time zone generation', () => {
  it('uses the browser zone', () => {
    expect(getLocalTimezone()).toBe('Europe/Berlin')
  })

  it('probes offsets via Intl', () => {
    expect(getTimezoneOffset('Europe/Berlin', Date.UTC(2026, 0, 15))).toBe(3600)
    expect(getTimezoneOffset('Europe/Berlin', Date.UTC(2026, 6, 15))).toBe(7200)
    expect(getTimezoneOffset('Asia/Kolkata', Date.UTC(2026, 6, 15))).toBe(19800)
  })

  it('generates a VTIMEZONE with yearly rules', () => {
    const ics = buildVTimezone('Europe/Berlin', 2025)!.toString()
    expect(ics).toContain('TZID:Europe/Berlin')
    expect(ics).toMatch(
      /BEGIN:DAYLIGHT\r\nTZOFFSETFROM:\+0100\r\nTZOFFSETTO:\+0200\r\nDTSTART:20250330T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU/
    )
    expect(ics).toMatch(
      /BEGIN:STANDARD\r\nTZOFFSETFROM:\+0200\r\nTZOFFSETTO:\+0100\r\nDTSTART:20251026T030000\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU/
    )
  })

  it('matches Intl offsets far in the future', () => {
    const zone = new ICAL.Timezone({
      component: buildVTimezone('America/New_York', 2025)!,
      tzid: 'America/New_York'
    })
    for (const ts of [Date.UTC(2045, 2, 1), Date.UTC(2045, 5, 1), Date.UTC(2045, 10, 20)]) {
      const time = ICAL.Time.fromJSDate(new Date(ts), true).convertToZone(zone)
      expect(time.utcOffset()).toBe(getTimezoneOffset('America/New_York', ts))
    }
  })

  it('returns null for unknown zones', () => {
    expect(buildVTimezone('Not/AZone', 2025)).toBeNull()
  })
})

describe('recurring events across DST changes', () => {
  it('writes DTSTART/DTEND with TZID and a VTIMEZONE', () => {
    const ics = generateICS(formData({}))
    expect(ics).toContain('DTSTART;TZID=Europe/Berlin:20260316T100000')
    expect(ics).toContain('DTEND;TZID=Europe/Berlin:20260316T110000')
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain('TZID:Europe/Berlin')
    expect(ics.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(ics.indexOf('BEGIN:VEVENT'))
  })

  it('keeps 10:00 Europe/Berlin across the March change', () => {
    const ics = generateICS(
      formData({ recurrence: { frequency: 'WEEKLY', interval: 1, endType: 'count', count: 4 } })
    )
    const events = parseICS(ics, HREF, 'etag', range('2026-03-01', '2026-05-01'))
    expect(events).toHaveLength(4)
    expect(events.map((e) => wallClock(e.start, 'Europe/Berlin'))).toEqual([
      '10:00',
      '10:00',
      '10:00',
      '10:00'
    ])
    // CET (UTC+1) before March 29, CEST (UTC+2) after
    expect(utcHours(events.map((e) => e.start))).toEqual([9, 9, 8, 8])
    expect(utcHours(events.map((e) => e.end))).toEqual([10, 10, 9, 9])
  })

  it('keeps 10:00 Europe/Berlin across the October change', () => {
    const ics = generateICS(
      formData({
        start: new Date('2026-10-12T08:00:00Z'),
        end: new Date('2026-10-12T09:00:00Z'),
        recurrence: { frequency: 'WEEKLY', interval: 1, endType: 'never' }
      })
    )
    const events = parseICS(ics, HREF, 'etag', range('2026-10-01', '2026-11-03'))
    expect(events).toHaveLength(4)
    expect(events.map((e) => wallClock(e.start, 'Europe/Berlin'))).toEqual([
      '10:00',
      '10:00',
      '10:00',
      '10:00'
    ])
    expect(utcHours(events.map((e) => e.start))).toEqual([8, 8, 9, 9])
  })

  it('keeps 10:00 in later years without explicit transitions', () => {
    const ics = generateICS(
      formData({ recurrence: { frequency: 'YEARLY', interval: 1, endType: 'never' } })
    )
    const events = parseICS(ics, HREF, 'etag', range('2040-01-01', '2040-12-31'))
    expect(events).toHaveLength(1)
    expect(events[0].start.toISOString()).toBe('2040-03-16T09:00:00.000Z')
  })

  it('excludes deleted occurrences after the DST change', () => {
    const ics = generateICS(
      formData({ recurrence: { frequency: 'WEEKLY', interval: 1, endType: 'count', count: 4 } })
    )
    const events = parseICS(ics, HREF, 'etag', range('2026-03-01', '2026-05-01'))
    expect(events[2].recurrenceId).toBe('2026-03-30T10:00:00')

    const updated = addExceptionToICS(ics, events[2].recurrenceId!)
    expect(updated).toContain('EXDATE;TZID=Europe/Berlin:20260330T100000')

    const remaining = parseICS(updated, HREF, 'etag', range('2026-03-01', '2026-05-01'))
    expect(remaining.map((e) => e.start.toISOString())).toEqual([
      '2026-03-16T09:00:00.000Z',
      '2026-03-23T09:00:00.000Z',
      '2026-04-06T08:00:00.000Z'
    ])
  })

  it('writes occurrence overrides in the zone of the series', () => {
    const ics = generateICS(
      formData({ recurrence: { frequency: 'WEEKLY', interval: 1, endType: 'count', count: 4 } })
    )
    const events = parseICS(ics, HREF, 'etag', range('2026-03-01', '2026-05-01'))
    const occurrence = events[2]

    const updated = addExceptionToICS(
      ics,
      occurrence.recurrenceId!,
      formData({
        summary: 'Moved',
        start: new Date('2026-03-30T10:00:00Z'),
        end: new Date('2026-03-30T11:00:00Z')
      })
    )
    expect(updated).toContain('RECURRENCE-ID;TZID=Europe/Berlin:20260330T100000')
    expect(updated).toContain('DTSTART;TZID=Europe/Berlin:20260330T120000')

    const parsed = parseICS(updated, HREF, 'etag', range('2026-03-01', '2026-05-01'))
    expect(parsed).toHaveLength(4)
    expect(parsed[2].summary).toBe('Moved')
    expect(parsed[2].recurrenceId).toBe(occurrence.recurrenceId)
    expect(parsed[2].start.toISOString()).toBe('2026-03-30T10:00:00.000Z')

    // editing the override again replaces it instead of adding a second one
    const again = addExceptionToICS(
      updated,
      parsed[2].recurrenceId!,
      formData({
        summary: 'Moved again',
        start: new Date('2026-03-30T12:00:00Z'),
        end: new Date('2026-03-30T13:00:00Z')
      })
    )
    expect(again.match(/RECURRENCE-ID/g)).toHaveLength(1)
    const reparsed = parseICS(again, HREF, 'etag', range('2026-03-01', '2026-05-01'))
    expect(reparsed[2].summary).toBe('Moved again')
  })

  it('matches RECURRENCE-ID and EXDATE given in UTC', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      buildVTimezone('Europe/Berlin', 2025)!.toString(),
      'BEGIN:VEVENT',
      'UID:utc-ids@test',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=Europe/Berlin:20260316T100000',
      'DTEND;TZID=Europe/Berlin:20260316T110000',
      'RRULE:FREQ=WEEKLY;COUNT=4',
      'EXDATE:20260323T090000Z',
      'SUMMARY:Series',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:utc-ids@test',
      'DTSTAMP:20260101T000000Z',
      'RECURRENCE-ID:20260330T080000Z',
      'DTSTART;TZID=Europe/Berlin:20260330T140000',
      'DTEND;TZID=Europe/Berlin:20260330T150000',
      'SUMMARY:Override',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    const events = parseICS(ics, HREF, 'etag', range('2026-03-01', '2026-05-01'))
    expect(events.map((e) => e.summary)).toEqual(['Series', 'Override', 'Series'])
    expect(events[1].recurrenceId).toBe('2026-03-30T10:00:00')
    expect(events[1].start.toISOString()).toBe('2026-03-30T12:00:00.000Z')
  })
})

describe('foreign time zones', () => {
  // Outlook style TZID that Intl does not know, defined only by the VTIMEZONE
  const outlookICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
    'BEGIN:VTIMEZONE',
    'TZID:Eastern Standard Time',
    'BEGIN:STANDARD',
    'DTSTART:16011104T020000',
    'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:16010311T020000',
    'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:outlook@test',
    'DTSTAMP:20260101T000000Z',
    'DTSTART;TZID=Eastern Standard Time:20260302T090000',
    'DTEND;TZID=Eastern Standard Time:20260302T093000',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'SUMMARY:Standup',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

  it('resolves TZID times with the VTIMEZONE of the calendar data', () => {
    const events = parseICS(outlookICS, HREF, 'etag', range('2026-03-01', '2026-04-01'))
    expect(events.map((e) => e.start.toISOString())).toEqual([
      '2026-03-02T14:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
      '2026-03-16T13:00:00.000Z'
    ])
    expect(events[0].end.toISOString()).toBe('2026-03-02T14:30:00.000Z')
  })

  it('resolves IANA TZIDs without VTIMEZONE via Intl', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:chicago@test',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=America/Chicago:20261025T100000',
      'DTEND;TZID=America/Chicago:20261025T110000',
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'SUMMARY:Chicago',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const events = parseICS(ics, HREF, 'etag', range('2026-10-01', '2026-12-01'))
    // CDT (UTC-5) until November 1, CST (UTC-6) after
    expect(utcHours(events.map((e) => e.start))).toEqual([15, 16, 16])
  })

  it('keeps the TZID of an existing event when editing it', () => {
    const updated = generateICS(
      formData({
        uid: 'outlook@test',
        start: new Date('2026-03-02T15:00:00Z'),
        end: new Date('2026-03-02T15:30:00Z')
      }),
      { sourceICS: outlookICS }
    )
    expect(updated).toContain('DTSTART;TZID=Eastern Standard Time:20260302T100000')
    expect(updated).toContain('TZID:Eastern Standard Time')
    expect(updated).not.toContain('Europe/Berlin')

    const series = updateSeriesICS(
      outlookICS,
      formData({
        uid: 'outlook@test',
        start: new Date('2026-03-02T15:00:00Z'),
        end: new Date('2026-03-02T15:30:00Z'),
        recurrence: { frequency: 'WEEKLY', interval: 1, endType: 'count', count: 3 }
      })
    )
    expect(series).toContain('DTSTART;TZID=Eastern Standard Time:20260302T100000')
    const events = parseICS(series, HREF, 'etag', range('2026-03-01', '2026-04-01'))
    expect(utcHours(events.map((e) => e.start))).toEqual([15, 14, 14])
  })

  it('moves events stored in UTC to the browser zone when edited', () => {
    const legacy = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpenCloud//Calendar//EN',
      'BEGIN:VEVENT',
      'UID:legacy@opencloud',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260316T090000Z',
      'DTEND:20260316T100000Z',
      'RRULE:FREQ=WEEKLY',
      'SUMMARY:Legacy',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const series = updateSeriesICS(
      legacy,
      formData({ recurrence: { frequency: 'WEEKLY', interval: 1, endType: 'never' } })
    )
    expect(series).toContain('DTSTART;TZID=Europe/Berlin:20260316T100000')
    expect(series).toContain('BEGIN:VTIMEZONE')
  })

  it('registers and completes time zones of imported files', () => {
    const { groups, errors } = parseICSFile(
      outlookICS
        .replace('UID:outlook@test', 'UID:outlook@test')
        .replace(
          'END:VEVENT',
          [
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:tokyo@test',
            'DTSTAMP:20260101T000000Z',
            'DTSTART;TZID=Asia/Tokyo:20260302T090000',
            'DTEND;TZID=Asia/Tokyo:20260302T100000',
            'SUMMARY:Tokyo',
            'END:VEVENT'
          ].join('\r\n')
        )
    )
    expect(errors).toEqual([])
    expect(groups).toHaveLength(2)
    const outlook = groups.find((g) => g.uid === 'outlook@test')!
    expect(outlook.rawICS).toContain('TZID:Eastern Standard Time')
    const tokyo = groups.find((g) => g.uid === 'tokyo@test')!
    expect(tokyo.rawICS).toContain('BEGIN:VTIMEZONE')
    expect(tokyo.rawICS).toContain('TZID:Asia/Tokyo')
    const [event] = parseICS(tokyo.rawICS, HREF, 'etag')
    expect(event.start.toISOString()).toBe('2026-03-02T00:00:00.000Z')
  })
})

describe('round trip', () => {
  it('parses a created event back to the same instants', () => {
    const data = formData({
      summary: 'Lunch; with, friends',
      description: 'Line 1\nLine 2',
      location: 'Café',
      start: new Date('2026-07-01T10:30:00Z'),
      end: new Date('2026-07-01T11:45:00Z')
    })
    const [event] = parseICS(generateICS(data), HREF, 'etag')
    expect(event.start.toISOString()).toBe(data.start.toISOString())
    expect(event.end.toISOString()).toBe(data.end.toISOString())
    expect(event.allDay).toBe(false)
    expect(event.summary).toBe(data.summary)
    expect(event.description).toBe(data.description)
    expect(event.location).toBe(data.location)
    expect(event.uid).toBe(data.uid)
  })

  it('writes UTC times for UTC zones', () => {
    const ics = generateICS(formData({}), { timezone: 'UTC' })
    expect(ics).toContain('DTSTART:20260316T090000Z')
    expect(ics).not.toContain('VTIMEZONE')
  })

  it('writes RRULE UNTIL in UTC', () => {
    const ics = generateICS(
      formData({
        recurrence: {
          frequency: 'DAILY',
          interval: 1,
          endType: 'until',
          until: new Date('2026-03-20T22:59:59Z')
        }
      })
    )
    expect(ics).toContain('RRULE:FREQ=DAILY;UNTIL=20260320T225959Z')
    const events = parseICS(ics, HREF, 'etag', range('2026-03-01', '2026-04-01'))
    expect(events).toHaveLength(5)
  })
})

describe('all-day events', () => {
  it('stay VALUE=DATE without TZID', () => {
    const data = formData({
      allDay: true,
      start: new Date(2026, 2, 29),
      end: new Date(2026, 2, 30),
      recurrence: { frequency: 'WEEKLY', interval: 1, endType: 'count', count: 2 }
    })
    const ics = generateICS(data)
    expect(ics).toContain('DTSTART;VALUE=DATE:20260329')
    expect(ics).toContain('DTEND;VALUE=DATE:20260330')
    expect(ics).not.toContain('TZID')
    expect(ics).not.toContain('VTIMEZONE')

    const events = parseICS(ics, HREF, 'etag', range('2026-03-01', '2026-05-01'))
    expect(events).toHaveLength(2)
    expect(events[0].allDay).toBe(true)
    expect(events[0].start).toEqual(new Date(2026, 2, 29))
    expect(events[0].end).toEqual(new Date(2026, 2, 30))
    expect(events[1].start).toEqual(new Date(2026, 3, 5))
    expect(events[0].recurrenceId).toBe('2026-03-29')

    const updated = addExceptionToICS(ics, events[1].recurrenceId!)
    expect(updated).toContain('EXDATE;VALUE=DATE:20260405')
    expect(parseICS(updated, HREF, 'etag', range('2026-03-01', '2026-05-01'))).toHaveLength(1)
  })
})
