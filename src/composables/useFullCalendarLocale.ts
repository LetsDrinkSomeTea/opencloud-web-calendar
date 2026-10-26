import { shallowRef, watch, type ShallowRef } from 'vue'
import { useGettext } from 'vue3-gettext'
import type { LocaleInput } from '@fullcalendar/core'
import { toLanguageTag } from '../utils/locale'

type LocaleLoader = () => Promise<{ default: LocaleInput }>

/**
 * FullCalendar locales for the languages OpenCloud Web offers (English is built in).
 *
 * Each locale is loaded on demand into its own small chunk instead of bundling
 * `@fullcalendar/core/locales-all` (~25 kB minified) into the calendar chunk.
 */
const LOCALE_LOADERS: Record<string, LocaleLoader> = {
  af: () => import('@fullcalendar/core/locales/af'),
  ar: () => import('@fullcalendar/core/locales/ar'),
  bg: () => import('@fullcalendar/core/locales/bg'),
  bs: () => import('@fullcalendar/core/locales/bs'),
  ca: () => import('@fullcalendar/core/locales/ca'),
  cs: () => import('@fullcalendar/core/locales/cs'),
  da: () => import('@fullcalendar/core/locales/da'),
  de: () => import('@fullcalendar/core/locales/de'),
  el: () => import('@fullcalendar/core/locales/el'),
  eo: () => import('@fullcalendar/core/locales/eo'),
  es: () => import('@fullcalendar/core/locales/es'),
  et: () => import('@fullcalendar/core/locales/et'),
  fa: () => import('@fullcalendar/core/locales/fa'),
  fi: () => import('@fullcalendar/core/locales/fi'),
  fr: () => import('@fullcalendar/core/locales/fr'),
  gl: () => import('@fullcalendar/core/locales/gl'),
  he: () => import('@fullcalendar/core/locales/he'),
  hr: () => import('@fullcalendar/core/locales/hr'),
  hu: () => import('@fullcalendar/core/locales/hu'),
  id: () => import('@fullcalendar/core/locales/id'),
  it: () => import('@fullcalendar/core/locales/it'),
  ja: () => import('@fullcalendar/core/locales/ja'),
  ka: () => import('@fullcalendar/core/locales/ka'),
  ko: () => import('@fullcalendar/core/locales/ko'),
  lv: () => import('@fullcalendar/core/locales/lv'),
  ms: () => import('@fullcalendar/core/locales/ms'),
  nb: () => import('@fullcalendar/core/locales/nb'),
  nl: () => import('@fullcalendar/core/locales/nl'),
  nn: () => import('@fullcalendar/core/locales/nn'),
  pl: () => import('@fullcalendar/core/locales/pl'),
  pt: () => import('@fullcalendar/core/locales/pt'),
  'pt-br': () => import('@fullcalendar/core/locales/pt-br'),
  ro: () => import('@fullcalendar/core/locales/ro'),
  ru: () => import('@fullcalendar/core/locales/ru'),
  si: () => import('@fullcalendar/core/locales/si-lk'),
  sk: () => import('@fullcalendar/core/locales/sk'),
  sl: () => import('@fullcalendar/core/locales/sl'),
  sq: () => import('@fullcalendar/core/locales/sq'),
  // OpenCloud labels Serbian in Cyrillic script
  sr: () => import('@fullcalendar/core/locales/sr-cyrl'),
  sv: () => import('@fullcalendar/core/locales/sv'),
  ta: () => import('@fullcalendar/core/locales/ta-in'),
  tr: () => import('@fullcalendar/core/locales/tr'),
  ug: () => import('@fullcalendar/core/locales/ug'),
  uk: () => import('@fullcalendar/core/locales/uk'),
  vi: () => import('@fullcalendar/core/locales/vi'),
  zh: () => import('@fullcalendar/core/locales/zh-cn'),
  'zh-tw': () => import('@fullcalendar/core/locales/zh-tw')
}
// Norwegian (`no`) is Bokmål in FullCalendar
LOCALE_LOADERS.no = LOCALE_LOADERS.nb

/** Finds the loader for a language, falling back from `pt-BR` to `pt`. */
export function findLocaleLoader(language: string | undefined): LocaleLoader | null {
  const tag = toLanguageTag(language).toLowerCase()
  return LOCALE_LOADERS[tag] || LOCALE_LOADERS[tag.split('-')[0]] || null
}

/**
 * The FullCalendar locale for the current OpenCloud (gettext) language.
 *
 * Starts with the language tag (dates are formatted through `Intl` right away) and is
 * replaced by the full locale (texts, first day of the week) once it has been loaded.
 * Follows language changes.
 */
export function useFullCalendarLocale(): ShallowRef<LocaleInput | string> {
  const language = useGettext()
  const locale = shallowRef<LocaleInput | string>(toLanguageTag(language.current))

  watch(
    () => language.current,
    async (current) => {
      const loader = findLocaleLoader(current)
      if (!loader) {
        locale.value = toLanguageTag(current)
        return
      }
      try {
        const { default: loaded } = await loader()
        // Ignore results of outdated requests after a quick language switch
        if (language.current === current) {
          locale.value = loaded
        }
      } catch (e) {
        console.warn('[web-calendar] Failed to load the calendar locale:', e)
        locale.value = toLanguageTag(current)
      }
    },
    { immediate: true }
  )

  return locale
}
