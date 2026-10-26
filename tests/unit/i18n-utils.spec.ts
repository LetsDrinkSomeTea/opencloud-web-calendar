import { describe, it, expect, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createGettext } from 'vue3-gettext'
import type { LocaleInput } from '@fullcalendar/core'
import {
  findLocaleLoader,
  useFullCalendarLocale
} from '../../src/composables/useFullCalendarLocale'
import { toLanguageTag } from '../../src/utils/locale'
import { translateError } from '../../src/utils/error-message'
import {
  AuthenticationError,
  CalDAVError,
  ConflictError,
  NetworkError,
  NotFoundError
} from '../../src/caldav/errors'

const $gettext = ((msgid: string) => `[${msgid}]`) as Parameters<typeof translateError>[1]

describe('toLanguageTag', () => {
  it('converts gettext language codes into BCP 47 tags', () => {
    expect(toLanguageTag('de')).toBe('de')
    expect(toLanguageTag('pt_BR')).toBe('pt-BR')
  })

  it('falls back to English', () => {
    expect(toLanguageTag('')).toBe('en')
    expect(toLanguageTag(undefined)).toBe('en')
  })
})

describe('translateError', () => {
  it('translates typed CalDAV errors', () => {
    for (const err of [
      new AuthenticationError(),
      new NotFoundError(),
      new ConflictError(),
      new NetworkError(),
      new CalDAVError('Forbidden', 403)
    ]) {
      expect(translateError(err, $gettext)).toMatch(/^\[.+\]$/)
    }
  })

  it('keeps the message of other errors', () => {
    expect(translateError(new CalDAVError('PROPFIND failed: Bad Gateway', 502), $gettext)).toBe(
      'PROPFIND failed: Bad Gateway'
    )
    expect(translateError('boom', $gettext)).toBe('boom')
  })

  it('has a translated fallback for unknown values', () => {
    expect(translateError(undefined, $gettext)).toBe('[An unexpected error occurred.]')
  })
})

describe('useFullCalendarLocale', () => {
  it('finds locale loaders, falling back to the primary language', () => {
    expect(findLocaleLoader('de')).not.toBeNull()
    expect(findLocaleLoader('de_CH')).toBe(findLocaleLoader('de'))
    expect(findLocaleLoader('en')).toBeNull()
    expect(findLocaleLoader('xx')).toBeNull()
  })

  it('loads the locale of the current language and follows changes', async () => {
    const gettext = createGettext({ defaultLanguage: 'de', silent: true })
    let locale!: ReturnType<typeof useFullCalendarLocale>
    const Host = defineComponent({
      setup() {
        locale = useFullCalendarLocale()
        return (): null => null
      }
    })
    mount(Host, { global: { plugins: [gettext] } })

    await vi.waitFor(() => expect((locale.value as LocaleInput).code).toBe('de'))
    expect((locale.value as LocaleInput & { week?: { dow: number } }).week?.dow).toBe(1)

    gettext.current = 'en'
    await vi.waitFor(() => expect(locale.value).toBe('en'))
  })
})
