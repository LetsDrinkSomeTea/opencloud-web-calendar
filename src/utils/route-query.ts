import type { LocationQuery, LocationQueryValue } from 'vue-router'
import type { CalendarViewType } from '../config'

/** Short, user friendly names used in the URL (`?view=week`) */
const VIEW_TO_QUERY: Record<CalendarViewType, string> = {
  dayGridMonth: 'month',
  timeGridWeek: 'week',
  timeGridDay: 'day',
  listAgenda: 'agenda'
}

const QUERY_TO_VIEW: Record<string, CalendarViewType> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
  agenda: 'listAgenda'
}

/** Query parameters of invite links created in the sharing dialog */
export const JOIN_QUERY_KEYS = [
  'join_token',
  'token',
  'path',
  'name',
  'color',
  'perm',
  'owner'
] as const

export interface JoinInviteParams {
  token?: string
  calendarPath?: string
  displayName?: string
  color?: string
  permissions: string
  owner?: string
}

type QueryInput = LocationQueryValue | LocationQueryValue[] | undefined

function firstValue(value: QueryInput): string | null {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' && v !== '' ? v : null
}

export function viewToQuery(view: CalendarViewType): string {
  return VIEW_TO_QUERY[view]
}

export function viewFromQuery(value: QueryInput): CalendarViewType | null {
  const v = firstValue(value)
  if (!v) return null
  if (v in VIEW_TO_QUERY) return v as CalendarViewType
  return QUERY_TO_VIEW[v.toLowerCase()] ?? null
}

/** Longest search query kept from the URL */
export const MAX_SEARCH_QUERY_LENGTH = 200

/** Reads the search query (`?q=…`), `''` when there is none */
export function searchFromQuery(value: QueryInput): string {
  const v = firstValue(value)
  return v ? v.trim().slice(0, MAX_SEARCH_QUERY_LENGTH) : ''
}

/** Value for the `q` query parameter, `undefined` removes it */
export function searchToQuery(search: string): string | undefined {
  const trimmed = search.trim().slice(0, MAX_SEARCH_QUERY_LENGTH)
  return trimmed || undefined
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Formats a date as local `YYYY-MM-DD` */
export function dateToQuery(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Parses a local `YYYY-MM-DD` date, returns `null` for anything invalid */
export function dateFromQuery(value: QueryInput): Date | null {
  const v = firstValue(value)
  if (!v) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

/**
 * Reads invite link parameters. Links put them into the route query
 * (`/web-calendar/?join_token=…`); older links put them behind the hash
 * (`/web-calendar/#/?join_token=…`), so the hash is checked as a fallback.
 */
export function parseJoinParams(query: LocationQuery, hash = ''): JoinInviteParams | null {
  let get = (key: string): string | null => firstValue(query[key])

  if (!get('join_token') && !get('token') && !get('path') && hash.includes('?')) {
    const hashParams = new URLSearchParams(hash.substring(hash.indexOf('?')))
    get = (key: string) => hashParams.get(key) || null
  }

  const token = get('join_token') || get('token')
  const path = get('path')
  if (!token && !path) return null

  return {
    token: token || undefined,
    calendarPath: path || undefined,
    displayName: get('name') || undefined,
    color: get('color') || undefined,
    permissions: get('perm') === 'rw' ? 'rw' : 'r',
    owner: get('owner') || undefined
  }
}

export function hasJoinParams(query: LocationQuery, hash = ''): boolean {
  return parseJoinParams(query, hash) !== null
}

/** Returns a copy of the query without invite link parameters */
export function withoutJoinParams(query: LocationQuery): LocationQuery {
  const result: LocationQuery = { ...query }
  for (const key of JOIN_QUERY_KEYS) {
    delete result[key]
  }
  return result
}

/**
 * Query parameters set by the "Import into calendar" action in the Files app
 * (`/web-calendar/?importFile=<file id>&importName=<file name>`)
 */
export const IMPORT_FILE_QUERY_KEYS = ['importFile', 'importName'] as const

export interface ImportFileParams {
  fileId: string
  name?: string
}

export function parseImportFileParams(query: LocationQuery): ImportFileParams | null {
  const fileId = firstValue(query.importFile)
  if (!fileId) return null
  return { fileId, name: firstValue(query.importName) || undefined }
}

/** Returns a copy of the query without the import file parameters */
export function withoutImportFileParams(query: LocationQuery): LocationQuery {
  const result: LocationQuery = { ...query }
  for (const key of IMPORT_FILE_QUERY_KEYS) {
    delete result[key]
  }
  return result
}
