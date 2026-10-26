import { useGettext, type Language } from 'vue3-gettext'
import EventDialog from '../components/EventDialog.vue'
import EventScopeDialog from '../components/EventScopeDialog.vue'
import { useEventEditor, type EditScope } from './useEventEditor'
import { useModalBinding } from './useModalBinding'
import type { Calendar } from '../types/calendar'

export function getEventDialogTitle(
  $gettext: Language['$gettext'],
  isEditing: boolean,
  editScope: EditScope | null
): string {
  const title = isEditing ? $gettext('Edit Event') : $gettext('New Event')
  if (editScope === 'single') {
    return `${title} — ${$gettext('this occurrence')}`
  }
  if (editScope === 'series') {
    return `${title} — ${$gettext('entire series')}`
  }
  return title
}

/**
 * Shows the event editor (`useEventEditor`) in OpenCloud modals: the scope question for recurring
 * events and the event form itself.
 */
export function useEventDialogs(options: {
  calendars: () => readonly Calendar[]
  onSaved: () => void
  onDeleted: () => void
}) {
  const { $gettext } = useGettext()
  const { isOpen, isEditing, editScope, showScopeDialog, close, cancelScopeDialog } =
    useEventEditor()

  useModalBinding({
    open: () => showScopeDialog.value,
    title: () => $gettext('Edit Recurring Event'),
    modal: () => ({
      customComponent: EventScopeDialog,
      hideConfirmButton: true,
      onCancel: cancelScopeDialog
    })
  })

  useModalBinding({
    open: () => isOpen.value,
    title: () => getEventDialogTitle($gettext, isEditing.value, editScope.value),
    modal: () => ({
      customComponent: EventDialog,
      customComponentAttrs: () => ({
        calendars: options.calendars(),
        onSaved: options.onSaved,
        onDeleted: options.onDeleted
      }),
      // The footer buttons are rendered by the component
      hideConfirmButton: true,
      focusTrapInitial: '#event-title',
      onCancel: close
    })
  })
}
