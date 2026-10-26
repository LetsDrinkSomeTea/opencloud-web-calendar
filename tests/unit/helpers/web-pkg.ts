import { reactive } from 'vue'
import type { Modal } from '@opencloud-eu/web-pkg'

/**
 * Minimal stand-ins for the `@opencloud-eu/web-pkg` stores used by the app. Use with
 * `vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)`.
 */
let nextId = 0

export const modalStore = reactive({
  modals: [] as Modal[],
  dispatchModal(data: Omit<Modal, 'id'>) {
    const modal = { ...data, id: `modal-${++nextId}` } as Modal
    modalStore.modals.push(modal)
    return modal
  },
  updateModal<K extends keyof Modal>(id: string, key: K, value: Modal[K]) {
    const modal = modalStore.modals.find((m) => m.id === id)
    modal[key] = value
  },
  removeModal(id: string) {
    modalStore.modals = modalStore.modals.filter((m) => m.id !== id)
  }
})

export const messageStore = reactive({
  messages: [] as Record<string, unknown>[],
  showMessage(data: Record<string, unknown>) {
    messageStore.messages.push({ status: 'passive', ...data })
  },
  showErrorMessage(data: Record<string, unknown>) {
    messageStore.messages.push({ status: 'danger', ...data })
  }
})

export function resetStores() {
  modalStore.modals = []
  messageStore.messages = []
}

export const modalActionsTarget = (modal: Modal) => `oc-modal-actions-${modal.id}`

export const webPkgMock = {
  modalActionsTarget,
  useModals: () => modalStore,
  useMessages: () => messageStore
}
