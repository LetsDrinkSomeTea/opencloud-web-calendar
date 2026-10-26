import { onBeforeUnmount, ref, watch, type WatchSource } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages, useUserStore } from '@opencloud-eu/web-pkg'
import { AlarmScheduler, collectPendingAlarms, type PendingAlarm } from '../utils/alarm-scheduler'
import type { CalendarEvent } from '../types/calendar'
import { toLanguageTag } from '../utils/locale'

// Kept across mounts, so an alarm is not shown again when the view is opened again
const firedAlarms = new Set<string>()

type PermissionState = NotificationPermission | 'unsupported'

function readPermission(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

const notificationPermission = ref<PermissionState>(readPermission())

/**
 * Browser notification permission. Permission must only be requested from an explicit user
 * action (e.g. a button click).
 */
export function useNotificationPermission() {
  async function requestPermission(): Promise<PermissionState> {
    if (readPermission() === 'unsupported') return 'unsupported'
    try {
      notificationPermission.value = await window.Notification.requestPermission()
    } catch {
      notificationPermission.value = readPermission()
    }
    return notificationPermission.value
  }

  notificationPermission.value = readPermission()
  return { notificationPermission, requestPermission }
}

/**
 * Shows reminders (`VALARM` with `DISPLAY` or `AUDIO` action) of the loaded events while the app
 * is open: as an OpenCloud notification and, if permitted, as a browser notification.
 */
export function useReminders(events: WatchSource<readonly CalendarEvent[]>) {
  const gettext = useGettext()
  const { $gettext } = gettext
  const messages = useMessages()
  const userStore = useUserStore()

  function formatStart(event: CalendarEvent): string {
    const options: Intl.DateTimeFormatOptions = event.allDay
      ? { dateStyle: 'full' }
      : { dateStyle: 'medium', timeStyle: 'short' }
    try {
      return new Intl.DateTimeFormat(toLanguageTag(gettext.current), options).format(event.start)
    } catch {
      return event.start.toLocaleString()
    }
  }

  function notify({ key, event }: PendingAlarm) {
    const summary = event.summary || $gettext('Untitled event')
    const title = $gettext('Reminder: %{summary}', { summary })
    const desc = [formatStart(event), event.location].filter(Boolean).join(' · ')

    messages.showMessage({ title, desc, status: 'primary' })

    if (readPermission() === 'granted') {
      try {
        new window.Notification(title, { body: desc, tag: key })
      } catch {
        // Some browsers (e.g. Chrome on Android) only allow notifications from a service worker
      }
    }
  }

  const scheduler = new AlarmScheduler(notify, firedAlarms)

  watch(
    events,
    (list) => {
      scheduler.schedule(collectPendingAlarms(list, Date.now(), userStore.user?.mail))
    },
    { immediate: true }
  )

  onBeforeUnmount(() => scheduler.clear())

  return { scheduler }
}
