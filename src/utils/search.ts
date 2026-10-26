import type { CalendarEvent } from '../types/calendar'

/** Event properties that are searched */
export const SEARCH_PROPERTIES = ['SUMMARY', 'LOCATION', 'DESCRIPTION'] as const

/**
 * Lower cases a text and removes diacritics, so "Müller", "MULLER" and "muller" compare equal.
 * Letters that don't decompose (ß, æ, ø, ł) are mapped to their usual ASCII spelling.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Checks whether every word of the query occurs in the title, location or description of the
 * event (case and diacritics insensitive). An empty query matches every event.
 */
export function eventMatchesQuery(
  event: Pick<CalendarEvent, 'summary' | 'location' | 'description'>,
  query: string
): boolean {
  const words = normalizeSearchText(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalizeSearchText(
    [event.summary, event.location, event.description].filter(Boolean).join('\n')
  )
  return words.every((word) => haystack.includes(word))
}

/** Unique key of an event occurrence */
export function eventKey(event: Pick<CalendarEvent, 'uid' | 'recurrenceId'>): string {
  return event.recurrenceId ? `${event.uid}_${event.recurrenceId}` : event.uid
}

/** Sorts events by start, then end, then title */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  return (
    a.start.getTime() - b.start.getTime() ||
    a.end.getTime() - b.end.getTime() ||
    a.summary.localeCompare(b.summary)
  )
}

/** Removes duplicates (by uid and recurrence id), keeping the first occurrence */
export function uniqueEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>()
  return events.filter((event) => {
    const key = `${event.calendarHref}\n${eventKey(event)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
