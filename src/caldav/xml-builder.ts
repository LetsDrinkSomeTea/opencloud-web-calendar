const DAV_NS = 'DAV:'
const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav'
const CALSERVER_NS = 'http://calendarserver.org/ns/'
const ICAL_NS = 'http://apple.com/ns/ical/'

export function buildPropfindCurrentUserPrincipal(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="${DAV_NS}">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`
}

export function buildPropfindCalendarHome(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop>
    <c:calendar-home-set/>
  </d:prop>
</d:propfind>`
}

export function buildPropfindCalendars(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}" xmlns:cs="${CALSERVER_NS}" xmlns:ic="${ICAL_NS}">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <d:current-user-privilege-set/>
    <c:calendar-description/>
    <ic:calendar-color/>
    <cs:getctag/>
  </d:prop>
</d:propfind>`
}

export function buildCalendarQuery(start: Date, end: Date): string {
  const startStr = formatDateTimeUTC(start)
  const endStr = formatDateTimeUTC(end)

  return `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startStr}" end="${endStr}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`
}

/**
 * calendar-query REPORT (RFC 4791, 9.7.5) for events in the time range whose property contains
 * the text. CalDAV filters can't combine properties with OR, so each property needs its own
 * query. Radicale compares lower cased texts, other servers use the `i;unicode-casemap`
 * collation; neither ignores diacritics.
 */
export function buildCalendarTextSearchQuery(
  property: string,
  text: string,
  start: Date,
  end: Date
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${formatDateTimeUTC(start)}" end="${formatDateTimeUTC(end)}"/>
        <c:prop-filter name="${escapeXml(property)}">
          <c:text-match collation="i;unicode-casemap">${escapeXml(text)}</c:text-match>
        </c:prop-filter>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`
}

export function buildMkCalendar(displayName: string, description?: string, color?: string): string {
  const descriptionProp = description
    ? `    <c:calendar-description>${escapeXml(description)}</c:calendar-description>\n`
    : ''

  const colorProp = color ? `    <ic:calendar-color>${escapeXml(color)}</ic:calendar-color>\n` : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<d:mkcalendar xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}" xmlns:ic="${ICAL_NS}">
  <d:set>
    <d:prop>
      <d:displayname>${escapeXml(displayName)}</d:displayname>
${descriptionProp}${colorProp}    </d:prop>
  </d:set>
</d:mkcalendar>`
}

export interface CalendarPropertiesUpdate {
  displayName?: string
  /** An empty string removes the description */
  description?: string
  color?: string
}

/**
 * PROPPATCH body (RFC 4918 9.2) that updates the display name, description (RFC 4791 5.2.1) and
 * color (Apple `calendar-color`, understood by Radicale, Apple and most clients) of a calendar.
 * Properties that are `undefined` are left untouched, an empty description is removed.
 */
export function buildProppatchCalendar(update: CalendarPropertiesUpdate): string {
  const set: string[] = []
  const remove: string[] = []

  if (update.displayName !== undefined) {
    set.push(`<d:displayname>${escapeXml(update.displayName)}</d:displayname>`)
  }
  if (update.description !== undefined) {
    if (update.description.trim()) {
      set.push(`<c:calendar-description>${escapeXml(update.description)}</c:calendar-description>`)
    } else {
      remove.push('<c:calendar-description/>')
    }
  }
  if (update.color !== undefined) {
    set.push(`<ic:calendar-color>${escapeXml(update.color)}</ic:calendar-color>`)
  }

  const block = (name: 'set' | 'remove', props: string[]) =>
    props.length
      ? `  <d:${name}>
    <d:prop>
${props.map((prop) => `      ${prop}`).join('\n')}
    </d:prop>
  </d:${name}>
`
      : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<d:propertyupdate xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}" xmlns:ic="${ICAL_NS}">
${block('set', set)}${block('remove', remove)}</d:propertyupdate>`
}

/**
 * calendar-query REPORT body without a time range or component filter: returns every calendar
 * object resource (events, tasks, journals) of the collection, used for exporting a calendar.
 */
export function buildCalendarQueryAll(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR"/>
  </c:filter>
</c:calendar-query>`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatDateTimeUTC(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}
