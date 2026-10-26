import {
  dateFromQuery,
  dateToQuery,
  parseJoinParams,
  searchFromQuery,
  searchToQuery,
  viewFromQuery,
  viewToQuery,
  withoutJoinParams
} from '../../src/utils/route-query'
import type { CalendarViewType } from '../../src/config'

describe('route query mapping', () => {
  describe('view', () => {
    it.each<[CalendarViewType, string]>([
      ['dayGridMonth', 'month'],
      ['timeGridWeek', 'week'],
      ['timeGridDay', 'day'],
      ['listAgenda', 'agenda']
    ])('round-trips %s <-> %s', (view, query) => {
      expect(viewToQuery(view)).toBe(query)
      expect(viewFromQuery(query)).toBe(view)
    })

    it('accepts FullCalendar view names and ignores case', () => {
      expect(viewFromQuery('timeGridWeek')).toBe('timeGridWeek')
      expect(viewFromQuery('DAY')).toBe('timeGridDay')
    })

    it('uses the first value of repeated params', () => {
      expect(viewFromQuery(['week', 'day'])).toBe('timeGridWeek')
    })

    it.each([undefined, null, '', 'year', 'listWeek', [], [null]])('rejects %j', (value) => {
      expect(viewFromQuery(value as any)).toBeNull()
    })
  })

  describe('search', () => {
    it('reads and trims the query', () => {
      expect(searchFromQuery('  Müller ')).toBe('Müller')
      expect(searchFromQuery(['team', 'other'])).toBe('team')
    })

    it.each([undefined, null, '', [], [null]])('returns an empty query for %j', (value) => {
      expect(searchFromQuery(value as any)).toBe('')
    })

    it('limits the length', () => {
      expect(searchFromQuery('x'.repeat(500))).toHaveLength(200)
    })

    it('removes empty queries from the URL', () => {
      expect(searchToQuery('  ')).toBeUndefined()
      expect(searchToQuery(' café ')).toBe('café')
    })
  })

  describe('date', () => {
    it('formats as local YYYY-MM-DD', () => {
      expect(dateToQuery(new Date(2026, 9, 26, 23, 59))).toBe('2026-10-26')
      expect(dateToQuery(new Date(2026, 0, 5))).toBe('2026-01-05')
    })

    it('parses to local midnight', () => {
      const date = dateFromQuery('2026-10-26')!
      expect(date.getFullYear()).toBe(2026)
      expect(date.getMonth()).toBe(9)
      expect(date.getDate()).toBe(26)
      expect(date.getHours()).toBe(0)
    })

    it('round-trips', () => {
      expect(dateToQuery(dateFromQuery('2024-02-29')!)).toBe('2024-02-29')
    })

    it.each([
      undefined,
      null,
      '',
      'today',
      '2026-13-01',
      '2026-02-30',
      '2023-02-29',
      '2026-1-1',
      '2026-10-26T10:00'
    ])('rejects %j', (value) => {
      expect(dateFromQuery(value as any)).toBeNull()
    })
  })

  describe('join params', () => {
    const inviteQuery = {
      join_token: '/.token/abc',
      path: '/caldav/alice/work/',
      name: 'Work & Play',
      color: '#ff0000',
      perm: 'rw'
    }

    it('reads invite links from the route query', () => {
      expect(parseJoinParams(inviteQuery)).toEqual({
        token: '/.token/abc',
        calendarPath: '/caldav/alice/work/',
        displayName: 'Work & Play',
        color: '#ff0000',
        permissions: 'rw',
        owner: undefined
      })
    })

    it('reads legacy invite links from the hash', () => {
      const hash =
        '#/?join_token=%2F.token%2Fabc&path=%2Fcaldav%2Falice%2Fwork%2F&name=Work%20%26%20Play&color=%23ff0000&perm=rw'
      expect(parseJoinParams({}, hash)).toEqual(parseJoinParams(inviteQuery))
    })

    it('supports the `token` alias and defaults to read-only', () => {
      expect(parseJoinParams({ token: 'abc', perm: 'admin' })).toMatchObject({
        token: 'abc',
        permissions: 'r'
      })
    })

    it('returns null without invite params', () => {
      expect(parseJoinParams({ view: 'week' }, '#section')).toBeNull()
      expect(parseJoinParams({})).toBeNull()
    })

    it('removes only invite params', () => {
      expect(
        withoutJoinParams({ ...inviteQuery, owner: 'bob', view: 'week', date: '2026-10-26' })
      ).toEqual({ view: 'week', date: '2026-10-26' })
    })
  })
})
