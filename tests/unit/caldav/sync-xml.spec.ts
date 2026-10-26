import { describe, it, expect } from 'vitest'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import {
  buildCalendarMultiget,
  buildFreeBusyQuery,
  buildPropfindCollectionState,
  buildSyncCollection
} from '../../../src/caldav/xml-builder'
import {
  parseCalendars,
  parseCollectionState,
  parseSyncCollection
} from '../../../src/caldav/xml-parser'

// XML for incremental sync (RFC 6578) and free/busy (RFC 4791 7.10)

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function parse(xml: string) {
  expect(XMLValidator.validate(xml)).toBe(true)
  return parser.parse(xml)
}

const multistatus = (body: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">${body}</d:multistatus>`

describe('request bodies', () => {
  it('requests ctag and sync token of a collection', () => {
    const prop = parse(buildPropfindCollectionState())['d:propfind']['d:prop']
    expect(Object.keys(prop).sort()).toEqual(['cs:getctag', 'd:sync-token'])
  })

  it('builds a sync-collection report with escaped token and ETags only', () => {
    const report = parse(buildSyncCollection('http://example.com/sync/1?a=1&b=2'))[
      'd:sync-collection'
    ]
    expect(report['@_xmlns:d']).toBe('DAV:')
    expect(report['d:sync-token']).toBe('http://example.com/sync/1?a=1&b=2')
    expect(report['d:sync-level']).toBe(1)
    expect(Object.keys(report['d:prop'])).toEqual(['d:getetag'])
  })

  it('builds a calendar-multiget with one escaped href per resource', () => {
    const report = parse(buildCalendarMultiget(['/caldav/a/c/1.ics', '/caldav/a/c/<2>.ics']))[
      'c:calendar-multiget'
    ]
    expect(report['d:prop']).toHaveProperty('d:getetag')
    expect(report['d:prop']).toHaveProperty('c:calendar-data')
    expect(report['d:href']).toEqual(['/caldav/a/c/1.ics', '/caldav/a/c/<2>.ics'])
  })

  it('builds a free-busy-query with a UTC time range', () => {
    const doc = parse(
      buildFreeBusyQuery(new Date('2026-10-26T10:00:00Z'), new Date('2026-10-27T00:00:00Z'))
    )
    const range = doc['c:free-busy-query']['c:time-range']
    expect(range['@_start']).toBe('20261026T100000Z')
    expect(range['@_end']).toBe('20261027T000000Z')
  })
})

describe('parseCalendars', () => {
  it('reads the sync token of a calendar', () => {
    const xml = multistatus(`
      <d:response>
        <d:href>/caldav/alice/personal/</d:href>
        <d:propstat>
          <d:prop>
            <d:resourcetype><d:collection/><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype>
            <cs:getctag>"ctag"</cs:getctag>
            <d:sync-token>http://radicale.org/ns/sync/abc</d:sync-token>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`)
    expect(parseCalendars(xml)[0]).toMatchObject({
      ctag: '"ctag"',
      syncToken: 'http://radicale.org/ns/sync/abc'
    })
  })
})

describe('parseCollectionState', () => {
  it('ignores properties the server does not support', () => {
    const xml = multistatus(`
      <d:response>
        <d:href>/caldav/alice/personal/</d:href>
        <d:propstat>
          <d:prop><cs:getctag>"ctag"</cs:getctag></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
        <d:propstat>
          <d:prop><d:sync-token/></d:prop>
          <d:status>HTTP/1.1 404 Not Found</d:status>
        </d:propstat>
      </d:response>`)
    expect(parseCollectionState(xml)).toEqual({ ctag: '"ctag"' })
  })
})

describe('parseSyncCollection', () => {
  it('returns the new token, changed members with ETag and removed members', () => {
    const xml = multistatus(`
      <d:sync-token>http://radicale.org/ns/sync/2</d:sync-token>
      <d:response>
        <d:href>/caldav/alice/personal/gone.ics</d:href>
        <d:status>HTTP/1.1 404 Not Found</d:status>
      </d:response>
      <d:response>
        <d:href>/caldav/alice/personal/new.ics</d:href>
        <d:propstat>
          <d:prop><d:getetag>"etag-new"</d:getetag></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`)
    expect(parseSyncCollection(xml)).toEqual({
      syncToken: 'http://radicale.org/ns/sync/2',
      changed: [{ href: '/caldav/alice/personal/new.ics', etag: 'etag-new' }],
      removed: ['/caldav/alice/personal/gone.ics']
    })
  })

  it('returns an empty change set for an unchanged collection', () => {
    expect(
      parseSyncCollection(multistatus('<d:sync-token>http://radicale.org/ns/sync/1</d:sync-token>'))
    ).toEqual({ syncToken: 'http://radicale.org/ns/sync/1', changed: [], removed: [] })
  })
})
