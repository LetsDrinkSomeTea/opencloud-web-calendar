import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import EventDialog from '../../src/components/EventDialog.vue'
import { nextTick, ref } from 'vue'
import { createGettext } from 'vue3-gettext'
import translations from '../../l10n/translations.json'
import type { RecurrenceFormData } from '../../src/types/calendar'

const mockFormData = ref({
  summary: '',
  calendarHref: '',
  start: new Date(),
  end: new Date(),
  allDay: false,
  description: '',
  location: '',
  recurrence: undefined as RecurrenceFormData | undefined
})
const mockSaving = ref(false)

// Mock the composables
vi.mock('../../src/composables/useEventEditor', () => ({
  useEventEditor: () => ({
    isOpen: ref(true),
    isEditing: ref(false),
    editingEvent: ref(null),
    formData: mockFormData,
    saving: mockSaving,
    error: ref(null),
    conflictData: ref(null),
    editScope: ref(null),
    showScopeDialog: ref(false),
    close: vi.fn(),
    save: vi.fn(),
    deleteEvent: vi.fn(),
    selectEditScope: vi.fn(),
    cancelScopeDialog: vi.fn(),
    resolveConflictKeepLocal: vi.fn(),
    resolveConflictUseServer: vi.fn()
  })
}))

vi.mock('../../src/composables/useLocationSearch', () => ({
  useLocationSearch: () => ({
    results: ref([]),
    loading: ref(false),
    search: vi.fn(),
    clearResults: vi.fn()
  })
}))

function mountDialog(language = 'en') {
  const gettext = createGettext({
    defaultLanguage: language,
    translations,
    silent: true
  })
  const wrapper = mount(EventDialog, {
    props: { calendars: [] },
    attachTo: '#app',
    global: { plugins: [gettext] }
  })
  return { wrapper, gettext }
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  mockFormData.value.summary = ''
  mockFormData.value.recurrence = undefined
  mockSaving.value = false
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('EventDialog.vue', () => {
  it('disables the save button when title is empty', async () => {
    mountDialog()

    await nextTick()

    const saveButton = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save')
    ) as HTMLButtonElement

    expect(saveButton).not.toBeUndefined()
    expect(saveButton.disabled).toBe(true)
  })

  it('disables the save button when title is only whitespace', async () => {
    mountDialog()

    await nextTick()

    const titleInput = document.querySelector('#event-title') as HTMLInputElement
    titleInput.value = '   '
    titleInput.dispatchEvent(new Event('input'))
    mockFormData.value.summary = '   '
    await nextTick()

    const saveButton = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save')
    ) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
  })

  it('enables the save button when title is provided', async () => {
    mountDialog()

    await nextTick()

    const titleInput = document.querySelector('#event-title') as HTMLInputElement
    titleInput.value = 'My Event'
    titleInput.dispatchEvent(new Event('input'))
    mockFormData.value.summary = 'My Event'
    await nextTick()

    const saveButton = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save')
    ) as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)
  })

  it('renders German strings when the language is de', async () => {
    mountDialog('de')
    await nextTick()

    const buttons = Array.from(document.querySelectorAll('button')).map((b) =>
      b.textContent?.trim()
    )
    expect(buttons).toContain('Speichern')
    expect(buttons).toContain('Abbrechen')
    expect(document.body.textContent).toContain('Neuer Termin')
    expect(document.body.textContent).not.toContain('New Event')
  })

  it('follows language changes', async () => {
    const { gettext } = mountDialog('de')
    await nextTick()
    expect(document.body.textContent).toContain('Neuer Termin')

    gettext.current = 'en'
    await nextTick()
    expect(document.body.textContent).toContain('New Event')
    expect(document.body.textContent).not.toContain('Neuer Termin')
  })

  it('uses plural forms for the recurrence interval', async () => {
    mockFormData.value.recurrence = { frequency: 'WEEKLY', interval: 2, endType: 'never' }
    mountDialog('de')
    await nextTick()

    const options = Array.from(document.querySelectorAll('option')).map((o) =>
      o.textContent?.trim()
    )
    expect(options).toEqual(expect.arrayContaining(['Tage', 'Wochen', 'Monate', 'Jahre']))
  })
})
