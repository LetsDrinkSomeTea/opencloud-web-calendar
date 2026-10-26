/**
 * Converts a gettext language code (`de`, `pt_BR`) into a BCP 47 language tag (`de`, `pt-BR`)
 * as expected by `Intl` and FullCalendar.
 */
export function toLanguageTag(language: string | undefined): string {
  const tag = (language || '').trim().replace(/_/g, '-')
  return tag || 'en'
}
