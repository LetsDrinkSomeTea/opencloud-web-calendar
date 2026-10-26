import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import EventDialog from '../../src/components/EventDialog.vue'
import type { Calendar, CalendarEvent, RecurrenceFormData } from '../../src/types/calendar'
import type { EditScope } from '../../src/composables/useEventEditor'
import { findButton, globalMountOptions } from './helpers/design-system'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const editor = vi.hoisted(() => ({
  save: vi.fn(),
  deleteEvent: vi.fn(),
  resolveConflictKeepLocal: vi.fn(),
  resolveConflictUseServer: vi.fn()
}))

const mockFormData = ref({
  summary: '',
  calendarHref: '',
  start: new Date(2026, 9, 26, 10),
  end: new Date(2026, 9, 26, 11),
  allDay: false,
  description: '',
  location: '',
  recurrence: undefined as RecurrenceFormData | undefined
})
const mockSaving = ref(false)
const mockIsEditing = ref(false)
const mockEditScope = ref<EditScope | null>(null)
const mockError = ref<Error | null>(null)
const mockConflict = ref<unknown>(null)

vi.mock('../../src/composables/useEventEditor', () => ({
  useEventEditor: () => ({
    isOpen: ref(true),
    isEditing: mockIsEditing,
    editingEvent: ref({ uid: 'uid-1', icsData: 'BEGIN:VCALENDAR' } as CalendarEvent),
    formData: mockFormData,
    saving: mockSaving,
    error: mockError,
    conflictData: mockConflict,
    editScope: mockEditScope,
    showScopeDialog: ref(false),
    close: vi.fn(),
    save: editor.save,
    deleteEvent: editor.deleteEvent,
    selectEditScope: vi.fn(),
    cancelScopeDialog: vi.fn(),
    resolveConflictKeepLocal: editor.resolveConflictKeepLocal,
    resolveConflictUseServer: editor.resolveConflictUseServer
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

const modal = { id: 'event', title: 'New Event' }

function mountDialog(language = 'en', calendars: Calendar[] = []) {
  const { gettext, global } = globalMountOptions(language)
  const wrapper = mount(EventDialog, {
    props: { modal, calendars },
    attachTo: '#app',
    global
  })
  return { wrapper, gettext }
}

function setTitle(value: string) {
  const titleInput = document.querySelector('#event-title') as HTMLInputElement
  titleInput.value = value
  titleInput.dispatchEvent(new Event('input'))
}

beforeEach(() => {
  // The footer buttons are teleported into the modal's actions row
  document.body.innerHTML = '<div id="app"></div><div id="oc-modal-actions-event"></div>'
  mockFormData.value.summary = ''
  mockFormData.value.calendarHref = ''
  mockFormData.value.recurrence = undefined
  mockSaving.value = false
  mockIsEditing.value = false
  mockEditScope.value = null
  mockError.value = null
  mockConflict.value = null
  editor.save.mockReset()
  editor.deleteEvent.mockReset()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('EventDialog.vue', () => {
  it('renders the footer buttons into the modal actions', async () => {
    mountDialog()
    await nextTick()

    const actions = document.querySelector('#oc-modal-actions-event')
    const labels = Array.from(actions.querySelectorAll('button')).map((b) => b.textContent.trim())
    expect(labels).toEqual(['Cancel', 'Save'])
  })

  it('disables the save button when title is empty', async () => {
    mountDialog()
    await nextTick()

    const saveButton = findButton('Save')
    expect(saveButton).not.toBeUndefined()
    expect(saveButton.disabled).toBe(true)
  })

  it('disables the save button when title is only whitespace', async () => {
    mountDialog()
    await nextTick()

    setTitle('   ')
    await nextTick()

    expect(mockFormData.value.summary).toBe('   ')
    expect(findButton('Save').disabled).toBe(true)
  })

  it('enables the save button when title is provided', async () => {
    mountDialog()
    await nextTick()

    setTitle('My Event')
    await nextTick()

    expect(mockFormData.value.summary).toBe('My Event')
    expect(findButton('Save').disabled).toBe(false)
  })

  it('disables the save button for read-only calendars', async () => {
    mockFormData.value.summary = 'My Event'
    mockFormData.value.calendarHref = '/cal/ro/'
    mountDialog('en', [
      {
        href: '/cal/ro/',
        displayName: 'RO',
        color: '#000',
        ctag: '',
        visible: true,
        readOnly: true
      }
    ])
    await nextTick()

    expect(findButton('Save').disabled).toBe(true)
  })

  it('labels the form controls', async () => {
    mountDialog()
    await nextTick()

    for (const id of ['event-title', 'event-start-date', 'event-start-time', 'event-location']) {
      expect(document.querySelector(`label[for="${id}"]`), id).not.toBeNull()
    }
    expect(document.querySelector('label[for="event-description"]')).not.toBeNull()
  })

  it('renders German strings when the language is de', async () => {
    mountDialog('de')
    await nextTick()

    expect(findButton('Speichern')).toBeDefined()
    expect(findButton('Abbrechen')).toBeDefined()
    expect(document.querySelector('label[for="event-title"]').textContent).toContain('Titel')
    expect(document.body.textContent).toContain('Ganztägig')
  })

  it('follows language changes', async () => {
    const { gettext } = mountDialog('de')
    await nextTick()
    expect(findButton('Speichern')).toBeDefined()

    gettext.current = 'en'
    await nextTick()
    expect(findButton('Save')).toBeDefined()
    expect(findButton('Speichern')).toBeUndefined()
  })

  it('uses plural forms for the recurrence interval', async () => {
    mockFormData.value.recurrence = { frequency: 'WEEKLY', interval: 2, endType: 'never' }
    mountDialog('de')
    await nextTick()

    expect(document.querySelector('.vs__selected').textContent.trim()).toBe('Wochen')

    mockFormData.value.recurrence = { ...mockFormData.value.recurrence, interval: 1 }
    await nextTick()
    expect(document.querySelector('.vs__selected').textContent.trim()).toBe('Woche')
  })

  it('toggles weekdays and exposes the state via aria-pressed', async () => {
    mockFormData.value.recurrence = { frequency: 'WEEKLY', interval: 1, endType: 'never' }
    mountDialog()
    await nextTick()

    const monday = findButton('Mon')
    expect(monday.getAttribute('aria-pressed')).toBe('false')
    monday.click()
    await nextTick()

    expect(mockFormData.value.recurrence.byDay).toEqual(['MO'])
    expect(findButton('Mon').getAttribute('aria-pressed')).toBe('true')
  })

  it('updates the recurrence interval from the number input', async () => {
    mockFormData.value.recurrence = { frequency: 'DAILY', interval: 1, endType: 'never' }
    mountDialog()
    await nextTick()

    const input = document.querySelector('#event-repeat-interval') as HTMLInputElement
    input.value = '3'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(mockFormData.value.recurrence.interval).toBe(3)

    // Incomplete input keeps the last valid value
    input.value = ''
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(mockFormData.value.recurrence.interval).toBe(3)
  })

  it('submits via the modal wrapper and saves on confirm', async () => {
    mockFormData.value.summary = 'My Event'
    const { wrapper } = mountDialog()
    await nextTick()

    document.querySelector('form').dispatchEvent(new Event('submit'))
    expect(wrapper.emitted('confirm')).toHaveLength(1)

    editor.save.mockResolvedValue({ uid: 'uid-1' })
    await (wrapper.vm as unknown as { onConfirm: () => Promise<void> }).onConfirm()
    expect(editor.save).toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('keeps the modal open when saving fails', async () => {
    mockFormData.value.summary = 'My Event'
    const { wrapper } = mountDialog()
    await nextTick()

    editor.save.mockResolvedValue(null)
    await expect(
      (wrapper.vm as unknown as { onConfirm: () => Promise<void> }).onConfirm()
    ).rejects.toBeUndefined()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('shows the save error inline', async () => {
    mockError.value = new Error('Boom')
    mountDialog()
    await nextTick()

    expect(document.querySelector('[role="alert"]').textContent).toContain('Boom')
  })

  it('emits cancel from the cancel button', async () => {
    const { wrapper } = mountDialog()
    await nextTick()

    findButton('Cancel').click()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('offers delete and export when editing', async () => {
    mockIsEditing.value = true
    mockEditScope.value = 'single'
    const { wrapper } = mountDialog()
    await nextTick()

    const exportButton = document.querySelector(
      '[aria-label="Download this occurrence as .ics"]'
    ) as HTMLButtonElement
    expect(exportButton).not.toBeNull()

    editor.deleteEvent.mockResolvedValue(true)
    findButton('Delete this event').click()
    await nextTick()
    await nextTick()
    expect(editor.deleteEvent).toHaveBeenCalled()
    expect(wrapper.emitted('deleted')).toHaveLength(1)
  })

  it('offers conflict resolution', async () => {
    mockConflict.value = { serverEvent: {}, localData: {} }
    mountDialog()
    await nextTick()

    findButton('Keep my changes').click()
    expect(editor.resolveConflictKeepLocal).toHaveBeenCalled()
    findButton('Use server version').click()
    expect(editor.resolveConflictUseServer).toHaveBeenCalled()
  })
})
