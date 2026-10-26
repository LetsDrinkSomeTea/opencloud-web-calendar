import type { AppConfigObject } from '@opencloud-eu/web-pkg'

export type CalendarViewType = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'

export interface LocationSearchConfig {
  enabled: boolean
  url: string
}

export interface CalendarConfig {
  /** Path of the CalDAV endpoint on the OpenCloud origin, without trailing slash */
  caldavBasePath: string
  locationSearch: LocationSearchConfig
  defaultView: CalendarViewType
  /** 0 = Sunday … 6 = Saturday, `null` = derived from the locale */
  firstDayOfWeek: number | null
}

export const CALENDAR_VIEWS: readonly CalendarViewType[] = [
  'dayGridMonth',
  'timeGridWeek',
  'timeGridDay'
]

export const DEFAULT_CONFIG: Readonly<CalendarConfig> = Object.freeze({
  caldavBasePath: '/caldav',
  locationSearch: Object.freeze({
    enabled: true,
    url: 'https://nominatim.openstreetmap.org/search'
  }),
  defaultView: 'dayGridMonth',
  firstDayOfWeek: null
})

const VIEW_ALIASES: Record<string, CalendarViewType> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function warnInvalid(key: string, value: unknown): void {
  console.warn(`[web-calendar] Ignoring invalid config value for "${key}":`, value)
}

export function parseCaldavBasePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null
  if (/[\s?#\\]/.test(trimmed)) return null
  const segments = trimmed.split('/').filter(Boolean)
  if (segments.length === 0) return null
  if (segments.some((s) => s === '.' || s === '..')) return null
  return `/${segments.join('/')}`
}

export function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return null
}

export function parseLocationSearchUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Same-origin path, e.g. a reverse proxy in front of a geocoder
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function parseView(value: unknown): CalendarViewType | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if ((CALENDAR_VIEWS as readonly string[]).includes(trimmed)) {
    return trimmed as CalendarViewType
  }
  return VIEW_ALIASES[trimmed.toLowerCase()] ?? null
}

export function parseFirstDayOfWeek(value: unknown): number | null {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN
  if (!Number.isInteger(num)) return null
  // Accept ISO 8601 style 7 for Sunday as well
  if (num === 7) return 0
  return num >= 0 && num <= 6 ? num : null
}

/**
 * Turns the raw `applicationConfig` (manifest defaults merged with the admin's apps.yaml)
 * into a validated config. Invalid or missing values fall back to the defaults.
 */
export function parseCalendarConfig(raw: unknown): CalendarConfig {
  const input = isPlainObject(raw) ? raw : {}
  const config: CalendarConfig = {
    caldavBasePath: DEFAULT_CONFIG.caldavBasePath,
    locationSearch: { ...DEFAULT_CONFIG.locationSearch },
    defaultView: DEFAULT_CONFIG.defaultView,
    firstDayOfWeek: DEFAULT_CONFIG.firstDayOfWeek
  }

  if (input.caldavBasePath !== undefined) {
    const parsed = parseCaldavBasePath(input.caldavBasePath)
    if (parsed) config.caldavBasePath = parsed
    else warnInvalid('caldavBasePath', input.caldavBasePath)
  }

  if (input.locationSearch !== undefined) {
    if (isPlainObject(input.locationSearch)) {
      const { enabled, url } = input.locationSearch
      if (enabled !== undefined) {
        const parsed = parseBoolean(enabled)
        if (parsed !== null) config.locationSearch.enabled = parsed
        else warnInvalid('locationSearch.enabled', enabled)
      }
      if (url !== undefined) {
        const parsed = parseLocationSearchUrl(url)
        if (parsed) config.locationSearch.url = parsed
        else warnInvalid('locationSearch.url', url)
      }
    } else {
      const parsed = parseBoolean(input.locationSearch)
      if (parsed !== null) config.locationSearch.enabled = parsed
      else warnInvalid('locationSearch', input.locationSearch)
    }
  }

  if (input.defaultView !== undefined) {
    const parsed = parseView(input.defaultView)
    if (parsed) config.defaultView = parsed
    else warnInvalid('defaultView', input.defaultView)
  }

  if (input.firstDayOfWeek !== undefined && input.firstDayOfWeek !== null) {
    const parsed = parseFirstDayOfWeek(input.firstDayOfWeek)
    if (parsed !== null) config.firstDayOfWeek = parsed
    else warnInvalid('firstDayOfWeek', input.firstDayOfWeek)
  }

  return config
}

let currentConfig: CalendarConfig = parseCalendarConfig({})

/** Called once from the application `setup()` with the `applicationConfig` provided by OpenCloud */
export function initCalendarConfig(applicationConfig: AppConfigObject | undefined): CalendarConfig {
  currentConfig = parseCalendarConfig(applicationConfig)
  return currentConfig
}

export function getCalendarConfig(): Readonly<CalendarConfig> {
  return currentConfig
}

/** Composable access to the validated app configuration */
export function useCalendarConfig(): Readonly<CalendarConfig> {
  return getCalendarConfig()
}

export function getCalDAVBasePath(): string {
  return currentConfig.caldavBasePath
}

/**
 * Removes the CalDAV base path from an href, e.g. `/caldav/user/cal/` -> `/user/cal/`.
 * Paths without the base path are returned unchanged.
 */
export function stripCalDAVBasePath(href: string): string {
  const base = getCalDAVBasePath()
  return href.startsWith(`${base}/`) ? href.slice(base.length) : href
}

/** Prefixes a (Radicale internal) path with the CalDAV base path unless it already has it */
export function withCalDAVBasePath(path: string): string {
  const base = getCalDAVBasePath()
  if (path === base || path.startsWith(`${base}/`)) return path
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`
}
