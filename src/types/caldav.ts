export interface PropfindResponse {
  href: string
  status: number
  props: Record<string, unknown>
}

export interface CalendarData {
  href: string
  displayName?: string
  color?: string
  ctag?: string
  syncToken?: string
  description?: string
  resourceType?: string[]
  readOnly?: boolean
  /** Component types from `supported-calendar-component-set` (e.g. VEVENT, VTODO); undefined if not advertised */
  components?: string[]
}

export interface EventData {
  href: string
  etag: string
  calendarData: string
}

/** Change markers of a calendar collection (`CS:getctag`, `DAV:sync-token`). */
export interface CollectionState {
  ctag?: string
  syncToken?: string
}

/** Result of a `sync-collection` REPORT. */
export interface SyncCollectionResult {
  syncToken: string
  /** Added or modified member resources */
  changed: Array<{ href: string; etag: string }>
  /** Hrefs of removed member resources */
  removed: string[]
}

export interface MultistatusResponse {
  responses: PropfindResponse[]
}
