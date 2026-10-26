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

export interface MultistatusResponse {
  responses: PropfindResponse[]
}
