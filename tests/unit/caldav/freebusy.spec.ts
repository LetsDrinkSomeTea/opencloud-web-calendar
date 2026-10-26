import { describe, it, expect, vi, afterEach } from 'vitest'
import { findOverlappingPeriods, parseFreeBusy, queryFreeBusy } from '../../../src/caldav/freebusy'
import { CalDAVError } from '../../../src/caldav/errors'
import { mockFetch, fetchCall, respond } from './fetch-mock'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useUserStore: () => ({ user: null as unknown })
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

const range = { start: new Date('2026-10-20T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') }

// As returned by Radicale 3.8 for a free-busy-query REPORT
function vfreebusy(...lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PYVOBJECT//NONSGML Version 0.9.9//EN',
    'BEGIN:VFREEBUSY',
    'DTSTART:20261020T000000Z',
    'DTEND:20261103T000000Z',
    'DTSTAMP:20261026T174019Z',
    ...lines,
    'END:VFREEBUSY',
    'END:VCALENDAR',
    ''
  ].join('\r\n')
}

function calendarResponse(body: string) {
  return respond({ status: 200, body, headers: { 'Content-Type': 'text/calendar' } })
}

describe('parseFreeBusy', () => {
  it('returns busy periods with their type and skips free time', () => {
    const periods = parseFreeBusy(
      vfreebusy(
        'FREEBUSY;FBTYPE=BUSY:20261027T100000Z/20261027T110000Z,20261028T090000Z/PT30M',
        'FREEBUSY;FBTYPE=BUSY-TENTATIVE:20261029T100000Z/20261029T120000Z',
        'FREEBUSY;FBTYPE=FREE:20261030T100000Z/20261030T120000Z'
      ),
      '/caldav/alice/personal/'
    )

    expect(periods.map((p) => [p.start.toISOString(), p.end.toISOString(), p.type])).toEqual([
      ['2026-10-27T10:00:00.000Z', '2026-10-27T11:00:00.000Z', 'BUSY'],
      ['2026-10-28T09:00:00.000Z', '2026-10-28T09:30:00.000Z', 'BUSY'],
      ['2026-10-29T10:00:00.000Z', '2026-10-29T12:00:00.000Z', 'BUSY-TENTATIVE']
    ])
    expect(periods[0].calendarHref).toBe('/caldav/alice/personal/')
  })

  it('treats FREEBUSY without FBTYPE as busy', () => {
    const [period] = parseFreeBusy(vfreebusy('FREEBUSY:20261027T100000Z/20261027T110000Z'))
    expect(period.type).toBe('BUSY')
  })

  it('returns nothing for a calendar without busy time', () => {
    expect(parseFreeBusy(vfreebusy())).toEqual([])
  })
})

describe('queryFreeBusy', () => {
  it('sends a free-busy-query REPORT per calendar and merges the periods sorted', async () => {
    const fetchMock = mockFetch(
      calendarResponse(vfreebusy('FREEBUSY;FBTYPE=BUSY:20261028T100000Z/20261028T110000Z')),
      calendarResponse(vfreebusy('FREEBUSY;FBTYPE=BUSY:20261027T100000Z/20261027T110000Z'))
    )

    const periods = await queryFreeBusy(['/caldav/alice/a/', '/caldav/bob/shared/'], range)

    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe('/caldav/alice/a/')
    expect(init.method).toBe('REPORT')
    expect(new Headers(init.headers).get('Depth')).toBe('1')
    expect(init.body).toContain('free-busy-query')
    expect(init.body).toContain('start="20261020T000000Z" end="20261103T000000Z"')
    expect(periods.map((p) => p.calendarHref)).toEqual(['/caldav/bob/shared/', '/caldav/alice/a/'])
  })

  it('skips calendars that cannot be queried', async () => {
    mockFetch(
      respond({ status: 403 }),
      calendarResponse(vfreebusy('FREEBUSY:20261027T100000Z/20261027T110000Z'))
    )
    await expect(
      queryFreeBusy(['/caldav/bob/x/', '/caldav/alice/a/'], range)
    ).resolves.toHaveLength(1)
  })

  it('fails when every calendar fails', async () => {
    mockFetch(respond({ status: 403 }), respond({ status: 500 }))
    const err = await queryFreeBusy(['/caldav/bob/x/', '/caldav/alice/a/'], range).catch(
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(CalDAVError)
    expect((err as CalDAVError).status).toBe(403)
  })

  it('sends no request without calendars', async () => {
    const fetchMock = mockFetch()
    await expect(queryFreeBusy([], range)).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('findOverlappingPeriods', () => {
  const periods = parseFreeBusy(
    vfreebusy('FREEBUSY:20261027T100000Z/20261027T110000Z,20261027T130000Z/20261027T140000Z')
  )
  const at = (time: string) => new Date(`2026-10-27T${time}:00Z`)

  it.each([
    ['09:00', '10:00', 0],
    ['09:30', '10:30', 1],
    ['11:00', '13:00', 0],
    ['10:30', '13:30', 2],
    ['10:15', '10:15', 1]
  ])('%s-%s overlaps %i periods', (start, end, count) => {
    expect(findOverlappingPeriods(periods, at(start), at(end))).toHaveLength(count)
  })
})
