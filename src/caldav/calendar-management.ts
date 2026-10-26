import { CalDAVError, AuthenticationError, ConflictError, NotFoundError } from './errors'
import {
  buildMkCalendar,
  buildProppatchCalendar,
  type CalendarPropertiesUpdate
} from './xml-builder'
import { parseFailedProperties } from './xml-parser'
import { authenticatedFetch } from './auth'
import type { Calendar } from '../types/calendar'

export interface CreateCalendarData {
  displayName: string
  description?: string
  color?: string
}

export async function createCalendar(
  calendarHomeUrl: string,
  data: CreateCalendarData
): Promise<Calendar> {
  // Generate calendar slug from display name
  const slug = generateCalendarSlug(data.displayName)
  const calendarUrl = `${calendarHomeUrl}${slug}/`

  const xml = buildMkCalendar(data.displayName, data.description, data.color)

  const response = await authenticatedFetch(calendarUrl, {
    method: 'MKCALENDAR',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    },
    body: xml
  })

  if (response.status === 401) {
    throw new AuthenticationError()
  }
  if (response.status === 405) {
    throw new CalDAVError('MKCALENDAR not supported by server', 405)
  }
  if (response.status === 409) {
    throw new ConflictError('Calendar with this name already exists')
  }
  if (!response.ok && response.status !== 201) {
    throw new CalDAVError(`Failed to create calendar: ${response.statusText}`, response.status)
  }

  return {
    href: calendarUrl,
    displayName: data.displayName,
    color: data.color || '#3788d8',
    ctag: '',
    description: data.description,
    visible: true
  }
}

export type UpdateCalendarData = CalendarPropertiesUpdate

/**
 * Renames / recolors a calendar collection via PROPPATCH. Servers answer with a 207 multistatus
 * that lists the status per property; any failed property makes the whole update fail.
 */
export async function updateCalendar(
  calendarHref: string,
  data: UpdateCalendarData
): Promise<void> {
  const response = await authenticatedFetch(calendarHref, {
    method: 'PROPPATCH',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    },
    body: buildProppatchCalendar(data)
  })

  if (response.status === 401) {
    throw new AuthenticationError()
  }
  if (response.status === 404) {
    throw new NotFoundError('Calendar not found')
  }
  if (response.status === 403) {
    throw new CalDAVError('Not allowed to change this calendar', 403)
  }
  if (!response.ok) {
    throw new CalDAVError(`Failed to update calendar: ${response.statusText}`, response.status)
  }

  if (response.status === 207) {
    const failed = parseFailedProperties(await response.text())
    if (failed.length > 0) {
      throw new CalDAVError(`Failed to update calendar properties: ${failed.join(', ')}`, 207)
    }
  }
}

export async function deleteCalendar(calendarHref: string): Promise<void> {
  const response = await authenticatedFetch(calendarHref, {
    method: 'DELETE'
  })

  if (response.status === 401) {
    throw new AuthenticationError()
  }
  if (response.status === 404) {
    // Already deleted, consider success
    return
  }
  if (!response.ok && response.status !== 204) {
    throw new CalDAVError(`Failed to delete calendar: ${response.statusText}`, response.status)
  }
}

function generateCalendarSlug(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') // Trim dashes
    .slice(0, 50) // Max length

  return slug || `calendar-${Date.now()}`
}
