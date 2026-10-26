import { markRaw, onBeforeUnmount, unref, watch, type WatchSource } from 'vue'
import { useModals, type Modal } from '@opencloud-eu/web-pkg'

export interface ModalBindingOptions {
  /** Whether the modal should be shown, e.g. the `isOpen` state of an editor composable */
  open: WatchSource<boolean>
  /** The modal title; kept in sync while the modal is open (e.g. on language changes) */
  title: () => string
  /** Everything else that is passed to `dispatchModal` */
  modal: () => Omit<Modal, 'id' | 'title'>
}

/**
 * Shows an OpenCloud modal (`useModals().dispatchModal`) while `open` is true.
 *
 * The dialogs keep their state in the existing composables (`useEventEditor`, `useCalendarEditor`,
 * …), which open and close them through an `isOpen` flag. This binds that flag to the modal store:
 * the modal is dispatched when the flag turns true and removed when it turns false (e.g. after a
 * successful save). Closing the modal via its close button or ESC calls `onCancel`, which is
 * expected to reset the flag.
 */
export function useModalBinding({ open, title, modal }: ModalBindingOptions) {
  const modalStore = useModals()
  let modalId: string | null = null

  const isDispatched = () =>
    modalId !== null && unref(modalStore.modals).some(({ id }) => id === modalId)

  const remove = () => {
    if (modalId !== null) {
      modalStore.removeModal(modalId)
      modalId = null
    }
  }

  watch(
    open,
    (isOpen) => {
      if (isOpen && !isDispatched()) {
        const { customComponent, ...options } = modal()
        modalId = modalStore.dispatchModal({
          ...options,
          title: title(),
          // Components must not be made reactive by the store
          ...(customComponent && { customComponent: markRaw(customComponent) })
        }).id
      } else if (!isOpen) {
        remove()
      }
    },
    { immediate: true }
  )

  watch(title, (value) => {
    if (isDispatched()) {
      modalStore.updateModal(modalId, 'title', value)
    }
  })

  onBeforeUnmount(remove)
}
