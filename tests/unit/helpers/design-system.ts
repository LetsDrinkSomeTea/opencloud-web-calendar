import { createGettext } from 'vue3-gettext'
import {
  OcButton,
  OcCheckbox,
  OcColorInput,
  OcFileInput,
  OcList,
  OcProgress,
  OcRadio,
  OcSearchBar,
  OcSelect,
  OcSpinner,
  OcTextarea,
  OcTextInput
} from '@opencloud-eu/design-system/components'
import translations from '../../../l10n/translations.json'

/**
 * The OpenCloud Web runtime registers the design system components globally, the app uses them
 * without importing them. Tests register the real components the same way.
 */
export const designSystemComponents = {
  OcButton,
  OcCheckbox,
  OcColorInput,
  OcFileInput,
  OcList,
  OcProgress,
  OcRadio,
  OcSearchBar,
  OcSelect,
  OcSpinner,
  OcTextarea,
  OcTextInput
}

/** `OcIcon` loads its SVGs over HTTP, so it is stubbed */
export const designSystemStubs = {
  OcIcon: true
}

export function createTestGettext(language = 'en') {
  return createGettext({ defaultLanguage: language, translations, silent: true })
}

export function globalMountOptions(language = 'en') {
  const gettext = createTestGettext(language)
  return {
    gettext,
    global: {
      plugins: [gettext],
      components: designSystemComponents,
      stubs: designSystemStubs
    }
  }
}

/** Finds a button in the document by its (trimmed) text */
export function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
}
