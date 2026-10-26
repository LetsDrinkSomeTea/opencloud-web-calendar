import { describe, it, expect } from 'vitest'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import {
  buildPropfindCurrentUserPrincipal,
  buildPropfindCalendarHome,
  buildPropfindCalendars,
  buildCalendarQuery,
  buildMkCalendar,
  buildProppatchCalendar,
  buildCalendarQueryAll,
  buildTaskQuery
} from '../../../src/caldav/xml-builder'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function parse(xml: string) {
  expect(XMLValidator.validate(xml)).toBe(true)
  return parser.parse(xml)
}

describe('PROPFIND bodies', () => {
  it('requests the current user principal', () => {
    const doc = parse(buildPropfindCurrentUserPrincipal())
    expect(doc['d:propfind']['@_xmlns:d']).toBe('DAV:')
    expect(doc['d:propfind']['d:prop']).toHaveProperty('d:current-user-principal')
  })

  it('requests the calendar home set in the CalDAV namespace', () => {
    const doc = parse(buildPropfindCalendarHome())
    expect(doc['d:propfind']['@_xmlns:c']).toBe('urn:ietf:params:xml:ns:caldav')
    expect(doc['d:propfind']['d:prop']).toHaveProperty('c:calendar-home-set')
  })

  it('requests all calendar collection properties', () => {
    const doc = parse(buildPropfindCalendars())
    const propfind = doc['d:propfind']
    expect(propfind['@_xmlns:cs']).toBe('http://calendarserver.org/ns/')
    expect(propfind['@_xmlns:ic']).toBe('http://apple.com/ns/ical/')
    expect(Object.keys(propfind['d:prop']).sort()).toEqual([
      'c:calendar-description',
      'c:supported-calendar-component-set',
      'cs:getctag',
      'd:current-user-privilege-set',
      'd:displayname',
      'd:resourcetype',
      'd:sync-token',
      'ic:calendar-color'
    ])
  })
})

describe('buildCalendarQuery', () => {
  it('builds a VEVENT time-range filter in UTC basic format', () => {
    const doc = parse(
      buildCalendarQuery(new Date('2024-03-01T00:00:00.000Z'), new Date('2024-04-15T12:30:45.678Z'))
    )
    const query = doc['c:calendar-query']
    expect(query['d:prop']).toHaveProperty('d:getetag')
    expect(query['d:prop']).toHaveProperty('c:calendar-data')

    const vcalendar = query['c:filter']['c:comp-filter']
    expect(vcalendar['@_name']).toBe('VCALENDAR')
    const vevent = vcalendar['c:comp-filter']
    expect(vevent['@_name']).toBe('VEVENT')
    expect(vevent['c:time-range']['@_start']).toBe('20240301T000000Z')
    expect(vevent['c:time-range']['@_end']).toBe('20240415T123045Z')
  })
})

describe('buildTaskQuery', () => {
  it('builds a VTODO filter without time range', () => {
    const query = parse(buildTaskQuery())['c:calendar-query']
    expect(query['d:prop']).toHaveProperty('c:calendar-data')
    const vcalendar = query['c:filter']['c:comp-filter']
    expect(vcalendar['@_name']).toBe('VCALENDAR')
    expect(vcalendar['c:comp-filter']).toEqual({ '@_name': 'VTODO' })
  })
})

describe('buildMkCalendar', () => {
  it('sets only the display name when nothing else is given', () => {
    const doc = parse(buildMkCalendar('Work'))
    const prop = doc['d:mkcalendar']['d:set']['d:prop']
    expect(prop).toEqual({ 'd:displayname': 'Work' })
  })

  it('includes description and color', () => {
    const doc = parse(buildMkCalendar('Work', 'Office stuff', '#ff0000'))
    const prop = doc['d:mkcalendar']['d:set']['d:prop']
    expect(prop['d:displayname']).toBe('Work')
    expect(prop['c:calendar-description']).toBe('Office stuff')
    expect(prop['ic:calendar-color']).toBe('#ff0000')
  })

  it('escapes XML special characters', () => {
    const xml = buildMkCalendar(`Tom & Jerry's <"Cartoons">`, '</d:prop><evil/>')
    expect(xml).toContain('Tom &amp; Jerry&apos;s &lt;&quot;Cartoons&quot;&gt;')
    expect(xml).not.toContain('<evil/>')

    const prop = parse(xml)['d:mkcalendar']['d:set']['d:prop']
    expect(prop['d:displayname']).toBe(`Tom & Jerry's <"Cartoons">`)
    expect(prop['c:calendar-description']).toBe('</d:prop><evil/>')
  })
})

describe('buildProppatchCalendar', () => {
  it('sets display name, description and color with the proper namespaces', () => {
    const doc = parse(
      buildProppatchCalendar({ displayName: 'Work', description: 'Office', color: '#ff0000' })
    )
    const update = doc['d:propertyupdate']
    expect(update['@_xmlns:d']).toBe('DAV:')
    expect(update['@_xmlns:c']).toBe('urn:ietf:params:xml:ns:caldav')
    expect(update['@_xmlns:ic']).toBe('http://apple.com/ns/ical/')
    expect(update['d:set']['d:prop']).toEqual({
      'd:displayname': 'Work',
      'c:calendar-description': 'Office',
      'ic:calendar-color': '#ff0000'
    })
    expect(update).not.toHaveProperty('d:remove')
  })

  it('removes an empty description', () => {
    const update = parse(buildProppatchCalendar({ displayName: 'Work', description: ' ' }))[
      'd:propertyupdate'
    ]
    expect(update['d:set']['d:prop']).toEqual({ 'd:displayname': 'Work' })
    expect(update['d:remove']['d:prop']).toHaveProperty('c:calendar-description')
  })

  it('leaves out undefined properties', () => {
    const update = parse(buildProppatchCalendar({ color: '#00ff00' }))['d:propertyupdate']
    expect(update['d:set']['d:prop']).toEqual({ 'ic:calendar-color': '#00ff00' })
  })

  it('escapes user input', () => {
    const update = parse(buildProppatchCalendar({ displayName: '</d:prop><evil/> & co' }))[
      'd:propertyupdate'
    ]
    expect(update['d:set']['d:prop']['d:displayname']).toBe('</d:prop><evil/> & co')
  })
})

describe('buildCalendarQueryAll', () => {
  it('requests all calendar objects without a time range', () => {
    const xml = buildCalendarQueryAll()
    const query = parse(xml)['c:calendar-query']
    expect(query['d:prop']).toHaveProperty('c:calendar-data')
    expect(query['c:filter']['c:comp-filter']['@_name']).toBe('VCALENDAR')
    expect(xml).not.toContain('time-range')
  })
})
