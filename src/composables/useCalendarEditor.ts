import { ref, readonly } from 'vue'
import { getCalDAVClient, type CreateCalendarData } from '../caldav/client'
import type { Calendar } from '../types/calendar'

const isOpen = ref(false)
const formData = ref<CreateCalendarData>(createEmptyFormData())
/** Calendar that is edited; `null` while creating a new calendar */
const editingCalendar = ref<Calendar | null>(null)
const saving = ref(false)
const error = ref<Error | null>(null)

function createEmptyFormData(): CreateCalendarData {
  return {
    displayName: '',
    description: '',
    color: '#3788d8'
  }
}

/** Own calendars can be edited, shared ones (even writable) belong to someone else */
export function canEditCalendar(calendar: Calendar): boolean {
  return !calendar.readOnly && !calendar.isShared
}

export function useCalendarEditor() {
  const client = getCalDAVClient()

  /** Opens the dialog for a new calendar, or for editing `calendar` when given */
  function open(calendar?: Calendar) {
    editingCalendar.value = calendar ?? null
    formData.value = calendar
      ? {
          displayName: calendar.displayName,
          description: calendar.description ?? '',
          color: calendar.color
        }
      : createEmptyFormData()
    error.value = null
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
    editingCalendar.value = null
    error.value = null
  }

  async function save(calendarHomeUrl: string): Promise<boolean> {
    saving.value = true
    error.value = null

    try {
      const calendar = editingCalendar.value
      if (calendar) {
        const data = formData.value
        await client.updateCalendar(calendar.href, {
          displayName: data.displayName.trim(),
          description: data.description ?? '',
          color: data.color
        })
      } else {
        await client.createCalendar(calendarHomeUrl, formData.value)
      }
      close()
      return true
    } catch (err) {
      error.value = err instanceof Error ? err : new Error('Failed to save calendar')
      return false
    } finally {
      saving.value = false
    }
  }

  return {
    isOpen: readonly(isOpen),
    editingCalendar: readonly(editingCalendar),
    formData,
    saving: readonly(saving),
    error: readonly(error),
    open,
    close,
    save
  }
}
