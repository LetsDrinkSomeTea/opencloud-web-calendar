import type { CalendarViewType } from '../config'

/** Number of days shown by the agenda view */
export const AGENDA_DAYS = 30

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** First (inclusive) and last (exclusive) day shown by a view starting at `viewDate` */
export function getViewDays(view: CalendarViewType, viewDate: Date): { start: Date; end: Date } {
  switch (view) {
    case 'dayGridMonth': {
      const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
      return { start, end: new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1) }
    }
    case 'timeGridWeek':
      return { start: startOfDay(viewDate), end: addDays(viewDate, 7) }
    case 'listAgenda':
      return { start: startOfDay(viewDate), end: addDays(viewDate, AGENDA_DAYS) }
    case 'timeGridDay':
    default:
      return { start: startOfDay(viewDate), end: addDays(viewDate, 1) }
  }
}

/** Hour new events start at on days other than today */
export const DEFAULT_START_HOUR = 9

/**
 * Start of an event created with the "New event" button: the next full hour today when today is
 * shown, otherwise 9:00 on the first shown day (e.g. the selected day in the day view).
 */
export function getDefaultEventStart(
  view: CalendarViewType,
  viewDate: Date,
  now: Date = new Date()
): Date {
  const { start, end } = getViewDays(view, viewDate)
  if (now >= start && now < end) {
    const next = new Date(now)
    next.setHours(now.getHours() + 1, 0, 0, 0)
    return next
  }
  const day = new Date(start)
  day.setHours(DEFAULT_START_HOUR, 0, 0, 0)
  return day
}
