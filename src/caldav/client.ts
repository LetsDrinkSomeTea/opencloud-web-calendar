import { discoverCalendars, listCalendars } from './discovery'
import {
  fetchEvents as fetchEventsFromCalendar,
  fetchEventResources,
  multigetEventResources,
  fetchCollectionState,
  syncCollection,
  type EventResource,
  createEvent,
  updateEvent,
  deleteEvent,
  fetchSingleEvent,
  updateEventOccurrence,
  deleteEventOccurrence,
  updateEventSeries
} from './events'
import {
  createCalendar as createCalendarRequest,
  deleteCalendar as deleteCalendarRequest,
  updateCalendar as updateCalendarRequest,
  type CreateCalendarData,
  type UpdateCalendarData
} from './calendar-management'
import { exportCalendar, type CalendarExport, type CalendarExportMeta } from './export'
import { queryFreeBusy, type BusyPeriod } from './freebusy'
import * as sharing from './sharing'
import type { Calendar, CalendarEvent, EventFormData, DateRange } from '../types/calendar'
import type { CollectionState, SyncCollectionResult } from '../types/caldav'

export {
  CalDAVError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  NetworkError,
  InvalidSyncTokenError
} from './errors'
export type { CreateCalendarData, UpdateCalendarData } from './calendar-management'
export type { CalendarExport, CalendarExportMeta } from './export'
export type { EventResource } from './events'
export type { BusyPeriod, BusyType } from './freebusy'
export type { Share, ShareInfo, ShareType } from './sharing'

export interface CalDAVClient {
  discoverCalendars(): Promise<Calendar[]>
  refreshCalendars(calendarHomeUrl: string): Promise<Calendar[]>
  fetchEvents(calendarHref: string, range: DateRange): Promise<CalendarEvent[]>
  fetchAllEvents(calendars: Calendar[], range: DateRange): Promise<CalendarEvent[]>
  fetchEventResources(calendarHref: string, range: DateRange): Promise<EventResource[]>
  multigetEventResources(
    calendarHref: string,
    hrefs: string[],
    range: DateRange
  ): Promise<EventResource[]>
  fetchCollectionState(calendarHref: string): Promise<CollectionState>
  syncCollection(calendarHref: string, syncToken: string): Promise<SyncCollectionResult>
  queryFreeBusy(calendarHrefs: string[], range: DateRange): Promise<BusyPeriod[]>
  createEvent(formData: EventFormData): Promise<CalendarEvent>
  updateEvent(event: CalendarEvent, formData: EventFormData): Promise<CalendarEvent>
  deleteEvent(event: CalendarEvent): Promise<void>
  fetchSingleEvent(href: string): Promise<CalendarEvent | null>
  updateEventOccurrence(
    event: CalendarEvent,
    recurrenceId: string,
    formData: EventFormData
  ): Promise<void>
  deleteEventOccurrence(event: CalendarEvent, recurrenceId: string): Promise<void>
  updateEventSeries(event: CalendarEvent, formData: EventFormData): Promise<void>
  createCalendar(calendarHomeUrl: string, data: CreateCalendarData): Promise<Calendar>
  updateCalendar(calendarHref: string, data: UpdateCalendarData): Promise<void>
  deleteCalendar(calendarHref: string): Promise<void>
  exportCalendar(calendarHref: string, meta?: CalendarExportMeta): Promise<CalendarExport>

  // Sharing methods
  getSharingInfo(): Promise<sharing.ShareInfo>
  listShares(
    type?: sharing.ShareType,
    filter?: { PathOrToken?: string; PathMapped?: string }
  ): Promise<sharing.Share[]>
  createShare(type: 'map' | 'token', data: any): Promise<{ PathOrToken: string }>
  updateShare(type: 'map' | 'token', data: any): Promise<void>
  deleteShare(type: 'map' | 'token', PathOrToken: string): Promise<void>
  enableShare(type: 'map' | 'token', PathOrToken: string): Promise<void>
  disableShare(type: 'map' | 'token', PathOrToken: string): Promise<void>
  hideShare(type: 'map' | 'token', PathOrToken: string): Promise<void>
  unhideShare(type: 'map' | 'token', PathOrToken: string): Promise<void>
}

export function createCalDAVClient(): CalDAVClient {
  return {
    discoverCalendars,

    refreshCalendars: listCalendars,

    fetchEvents: fetchEventsFromCalendar,

    async fetchAllEvents(calendars: Calendar[], range: DateRange): Promise<CalendarEvent[]> {
      const visibleCalendars = calendars.filter((c) => c.visible)
      const results = await Promise.all(
        visibleCalendars.map((cal) => fetchEventsFromCalendar(cal.href, range))
      )
      return results.flat()
    },

    fetchEventResources,
    multigetEventResources,
    fetchCollectionState,
    syncCollection,
    queryFreeBusy,

    createEvent,
    updateEvent,
    deleteEvent,
    fetchSingleEvent,
    updateEventOccurrence,
    deleteEventOccurrence,
    updateEventSeries,
    createCalendar: createCalendarRequest,
    updateCalendar: updateCalendarRequest,
    deleteCalendar: deleteCalendarRequest,
    exportCalendar,

    // Sharing methods
    getSharingInfo: sharing.getSharingInfo,
    listShares: sharing.listShares,
    createShare: sharing.createShare,
    updateShare: sharing.updateShare,
    deleteShare: sharing.deleteShare,
    enableShare: sharing.enableShare,
    disableShare: sharing.disableShare,
    hideShare: sharing.hideShare,
    unhideShare: sharing.unhideShare
  }
}

// Singleton instance
let clientInstance: CalDAVClient | null = null

export function getCalDAVClient(): CalDAVClient {
  if (!clientInstance) {
    clientInstance = createCalDAVClient()
  }
  return clientInstance
}
