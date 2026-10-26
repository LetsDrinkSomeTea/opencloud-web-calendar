import {
  DEFAULT_CONFIG,
  getCalendarConfig,
  initCalendarConfig,
  parseCalendarConfig,
  stripCalDAVBasePath,
  withCalDAVBasePath
} from '../../src/config'
import manifest from '../../src/manifest.json'

describe('parseCalendarConfig', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    initCalendarConfig({})
  })

  it('returns the defaults for missing or non-object input', () => {
    expect(parseCalendarConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(parseCalendarConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(parseCalendarConfig('foo')).toEqual(DEFAULT_CONFIG)
    expect(parseCalendarConfig([])).toEqual(DEFAULT_CONFIG)
    expect(parseCalendarConfig({})).toEqual(DEFAULT_CONFIG)
  })

  it('accepts the manifest defaults', () => {
    expect(parseCalendarConfig(manifest.config)).toEqual(DEFAULT_CONFIG)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('reads valid values', () => {
    expect(
      parseCalendarConfig({
        caldavBasePath: '/dav/calendars/',
        locationSearch: { enabled: false, url: 'https://geo.example.com/search' },
        defaultView: 'timeGridWeek',
        firstDayOfWeek: 0
      })
    ).toEqual({
      caldavBasePath: '/dav/calendars',
      locationSearch: { enabled: false, url: 'https://geo.example.com/search' },
      defaultView: 'timeGridWeek',
      firstDayOfWeek: 0
    })
  })

  describe('caldavBasePath', () => {
    it.each([
      ['/caldav', '/caldav'],
      ['/caldav/', '/caldav'],
      [' /radicale ', '/radicale'],
      ['/a//b/', '/a/b']
    ])('normalizes %j to %j', (input, expected) => {
      expect(parseCalendarConfig({ caldavBasePath: input }).caldavBasePath).toBe(expected)
    })

    it.each([
      'caldav',
      '/',
      '//evil.example.com/caldav',
      'https://evil.example.com/caldav',
      '/caldav/../graph',
      '/cal dav',
      '/caldav?x=1',
      '/caldav#x',
      42
    ])('falls back to the default for %j', (input) => {
      expect(parseCalendarConfig({ caldavBasePath: input }).caldavBasePath).toBe('/caldav')
      expect(console.warn).toHaveBeenCalled()
    })
  })

  describe('locationSearch', () => {
    it('accepts string booleans from yaml/env', () => {
      expect(parseCalendarConfig({ locationSearch: { enabled: 'false' } }).locationSearch).toEqual({
        enabled: false,
        url: DEFAULT_CONFIG.locationSearch.url
      })
    })

    it('accepts a plain boolean as shorthand', () => {
      expect(parseCalendarConfig({ locationSearch: false }).locationSearch.enabled).toBe(false)
    })

    it('accepts same-origin paths', () => {
      expect(
        parseCalendarConfig({ locationSearch: { url: '/geocoder/search' } }).locationSearch.url
      ).toBe('/geocoder/search')
    })

    it.each(['javascript:alert(1)', 'ftp://example.com', 'not a url', '', '//example.com', 1])(
      'ignores invalid url %j',
      (url) => {
        expect(parseCalendarConfig({ locationSearch: { url } }).locationSearch.url).toBe(
          DEFAULT_CONFIG.locationSearch.url
        )
      }
    )

    it('ignores an invalid enabled flag', () => {
      expect(
        parseCalendarConfig({ locationSearch: { enabled: 'nope' } }).locationSearch.enabled
      ).toBe(true)
    })
  })

  describe('defaultView', () => {
    it.each([
      ['dayGridMonth', 'dayGridMonth'],
      ['timeGridWeek', 'timeGridWeek'],
      ['timeGridDay', 'timeGridDay'],
      ['month', 'dayGridMonth'],
      ['Week', 'timeGridWeek'],
      ['day', 'timeGridDay']
    ])('maps %j to %j', (input, expected) => {
      expect(parseCalendarConfig({ defaultView: input }).defaultView).toBe(expected)
    })

    it.each(['listWeek', 'year', '', null, 3])('falls back to month for %j', (input) => {
      expect(parseCalendarConfig({ defaultView: input }).defaultView).toBe('dayGridMonth')
    })
  })

  describe('firstDayOfWeek', () => {
    it.each([
      [0, 0],
      [1, 1],
      [6, 6],
      [7, 0],
      ['1', 1]
    ])('maps %j to %j', (input, expected) => {
      expect(parseCalendarConfig({ firstDayOfWeek: input }).firstDayOfWeek).toBe(expected)
    })

    it.each([-1, 8, 1.5, 'monday', '', true, null])('uses the locale for %j', (input) => {
      expect(parseCalendarConfig({ firstDayOfWeek: input }).firstDayOfWeek).toBeNull()
    })
  })

  describe('base path helpers', () => {
    it('use the configured base path', () => {
      initCalendarConfig({ caldavBasePath: '/dav' })
      expect(getCalendarConfig().caldavBasePath).toBe('/dav')
      expect(stripCalDAVBasePath('/dav/user/cal/')).toBe('/user/cal/')
      expect(stripCalDAVBasePath('/user/cal/')).toBe('/user/cal/')
      expect(withCalDAVBasePath('/user/cal/')).toBe('/dav/user/cal/')
      expect(withCalDAVBasePath('.token/abc')).toBe('/dav/.token/abc')
      expect(withCalDAVBasePath('/dav/user/')).toBe('/dav/user/')
    })
  })
})
