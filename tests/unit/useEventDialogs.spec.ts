import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { getEventDialogTitle, useEventDialogs } from '../../src/composables/useEventDialogs'
import type { EditScope } from '../../src/composables/useEventEditor'
import EventDialog from '../../src/components/EventDialog.vue'
import EventScopeDialog from '../../src/components/EventScopeDialog.vue'
import { createTestGettext } from './helpers/design-system'
import { modalStore, resetStores } from './helpers/web-pkg'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const isOpen = ref(false)
const showScopeDialog = ref(false)
const isEditing = ref(false)
const editScope = ref<EditScope | null>(null)
const close = vi.fn()
const cancelScopeDialog = vi.fn()

vi.mock('../../src/composables/useEventEditor', () => ({
  useEventEditor: () => ({
    isOpen,
    isEditing,
    editScope,
    showScopeDialog,
    close,
    cancelScopeDialog
  })
}))

const identity = (s: string) => s
let wrapper: VueWrapper | null = null

function mountHost(language = 'en') {
  const onSaved = vi.fn()
  const onDeleted = vi.fn()
  const calendars = [{ href: '/cal/', displayName: 'Cal', color: '#000', ctag: '', visible: true }]
  wrapper = mount(
    defineComponent({
      setup() {
        useEventDialogs({ calendars: () => calendars, onSaved, onDeleted })
        return () => h('div')
      }
    }),
    { global: { plugins: [createTestGettext(language)] } }
  )
  return { onSaved, onDeleted, calendars }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

beforeEach(() => {
  resetStores()
  isOpen.value = false
  showScopeDialog.value = false
  isEditing.value = false
  editScope.value = null
})

describe('getEventDialogTitle', () => {
  it('describes the dialog', () => {
    expect(getEventDialogTitle(identity, false, null)).toBe('New Event')
    expect(getEventDialogTitle(identity, true, null)).toBe('Edit Event')
    expect(getEventDialogTitle(identity, true, 'single')).toBe('Edit Event — this occurrence')
    expect(getEventDialogTitle(identity, true, 'series')).toBe('Edit Event — entire series')
  })
})

describe('useEventDialogs', () => {
  it('shows the event form as a modal', async () => {
    const { onSaved, onDeleted, calendars } = mountHost()
    isOpen.value = true
    await nextTick()

    expect(modalStore.modals).toHaveLength(1)
    const [modal] = modalStore.modals
    expect(modal.title).toBe('New Event')
    expect(modal.customComponent).toBe(EventDialog)
    expect(modal.hideConfirmButton).toBe(true)
    expect(modal.focusTrapInitial).toBe('#event-title')
    expect(modal.customComponentAttrs()).toEqual({ calendars, onSaved, onDeleted })

    modal.onCancel()
    expect(close).toHaveBeenCalled()
  })

  it('translates the title', async () => {
    mountHost('de')
    isOpen.value = true
    await nextTick()
    expect(modalStore.modals[0].title).toBe('Neuer Termin')
  })

  it('asks for the scope of recurring events first', async () => {
    mountHost()
    showScopeDialog.value = true
    await nextTick()

    expect(modalStore.modals).toHaveLength(1)
    expect(modalStore.modals[0]).toMatchObject({
      title: 'Edit Recurring Event',
      hideConfirmButton: true
    })
    expect(modalStore.modals[0].customComponent).toBe(EventScopeDialog)

    // Choosing a scope closes the question and opens the form
    showScopeDialog.value = false
    isOpen.value = true
    isEditing.value = true
    editScope.value = 'series'
    await nextTick()

    expect(modalStore.modals).toHaveLength(1)
    expect(modalStore.modals[0].title).toBe('Edit Event — entire series')
  })

  it('cancels the scope question', async () => {
    mountHost()
    showScopeDialog.value = true
    await nextTick()

    modalStore.modals[0].onCancel()
    expect(cancelScopeDialog).toHaveBeenCalled()
  })
})
