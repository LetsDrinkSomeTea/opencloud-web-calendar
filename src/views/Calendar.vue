<!-- eslint-disable vue/multi-word-component-names -- route view loaded only via the router, never used as a tag; the file name is referenced in index.ts and the roadmap -->
<script setup lang="ts">
import { ref, computed, onMounted, watch, unref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages, useModals, useRoute, useRouter } from '@opencloud-eu/web-pkg'
import type { LocationQuery } from 'vue-router'
import CalendarToolbar from '../components/CalendarToolbar.vue'
import CalendarSidebar from '../components/CalendarSidebar.vue'
import CalendarView from '../components/CalendarView.vue'
import CalendarDialog from '../components/CalendarDialog.vue'
import ICSImportDialog from '../components/ICSImportDialog.vue'
import CalendarSharingDialog from '../components/CalendarSharingDialog.vue'
import InviteJoinDialog, { type InviteData } from '../components/InviteJoinDialog.vue'
import { useCalendars } from '../composables/useCalendars'
import { useEvents } from '../composables/useEvents'
import { useEventEditor } from '../composables/useEventEditor'
import { useCalendarEditor } from '../composables/useCalendarEditor'
import { useICSImport } from '../composables/useICSImport'
import { useEventDialogs } from '../composables/useEventDialogs'
import { useModalBinding } from '../composables/useModalBinding'
import { useErrorMessage } from '../composables/useErrorMessage'
import { useReminders } from '../composables/useReminders'
import { getExtendedRange } from '../utils/date'
import { getCalDAVClient } from '../caldav/client'
import { useCalendarConfig, type CalendarViewType } from '../config'
import {
  dateFromQuery,
  dateToQuery,
  parseJoinParams,
  viewFromQuery,
  viewToQuery,
  withoutJoinParams
} from '../utils/route-query'
import type { Calendar, CalendarEvent } from '../types/calendar'

const route = useRoute()
const router = useRouter()
const config = useCalendarConfig()

const { $gettext } = useGettext()
const { showMessage } = useMessages()
const { showError } = useErrorMessage()
const { dispatchModal } = useModals()

const {
  calendars,
  loading: calendarsLoading,
  calendarHomeUrl,
  loadCalendars,
  toggleCalendarVisibility,
  getDefaultCalendar,
  deleteCalendar,
  leaveCalendar,
  joinCalendarViaInvite,
  isCalendarAlreadyJoined,
  pendingShares,
  acceptShare,
  declineShare,
  userProfiles
} = useCalendars()

const { fetchEvents, getVisibleEvents, updateEventInCache } = useEvents()

const { openCreate, openEdit } = useEventEditor()
const {
  isOpen: calendarEditorOpen,
  open: openCalendarEditor,
  close: closeCalendarEditor
} = useCalendarEditor()
const { isOpen: importOpen, open: openImport, close: closeImport } = useICSImport()

const sidebarOpen = ref(false)

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

// Sharing dialog state
const sharingCalendar = ref<Calendar | null>(null)

// Invite Join dialog state
const pendingJoinInvite = ref<InviteData | null>(null)

// Route updates are serialized so concurrent changes (view, date, invite params) don't overwrite
// each other. `router.replace` keeps the browser history clean.
let routeUpdate: Promise<unknown> = Promise.resolve()
let pendingRouteUpdates = 0
function replaceRoute(update: (query: LocationQuery, hash: string) => [LocationQuery, string]) {
  pendingRouteUpdates++
  routeUpdate = routeUpdate.then(async () => {
    const current = unref(route)
    const [query, hash] = update(current.query, current.hash)
    try {
      await router.replace({ path: current.path, query, hash })
    } catch (e) {
      console.error('Failed to update route:', e)
    } finally {
      pendingRouteUpdates--
    }
  })
  return routeUpdate
}

// Invite that was already accepted or dismissed but may still be in the URL until the
// route update has finished
let handledJoinKey: string | null = null

function checkJoinInvite() {
  const params = parseJoinParams(unref(route).query, unref(route).hash)
  if (!params) return

  const checkKey = params.token || params.calendarPath || ''
  if (checkKey === handledJoinKey) return
  if (isCalendarAlreadyJoined(checkKey)) {
    showMessage({ title: $gettext('You are already subscribed to this calendar.') })
    clearJoinUrlParams()
    return
  }

  pendingJoinInvite.value = {
    token: params.token,
    calendarPath: params.calendarPath,
    displayName: params.displayName || $gettext('Shared Calendar'),
    color: params.color || '#3788d8',
    permissions: params.permissions,
    owner: params.owner
  }
}

function clearJoinUrlParams() {
  const params = parseJoinParams(unref(route).query, unref(route).hash)
  handledJoinKey = params ? params.token || params.calendarPath || '' : null
  replaceRoute((query, hash) => [
    withoutJoinParams(query),
    // Legacy invite links carry their parameters in the hash (`#/?join_token=…`)
    hash.includes('?') ? '' : hash
  ])
}

async function handleJoinCalendar() {
  if (!pendingJoinInvite.value) return
  try {
    // Failures are reported by `joinCalendarViaInvite`
    const success = await joinCalendarViaInvite(pendingJoinInvite.value)
    if (success) {
      showMessage({ title: $gettext('Joined calendar successfully') })
      await loadEventsForCurrentRange()
    }
  } finally {
    pendingJoinInvite.value = null
    clearJoinUrlParams()
  }
}

function handleCancelJoin() {
  pendingJoinInvite.value = null
  clearJoinUrlParams()
}

const calendarViewRef = ref<InstanceType<typeof CalendarView> | null>(null)
// View and date are restored from the route query (`?view=week&date=2026-10-26`)
const currentDate = ref(dateFromQuery(unref(route).query.date) || new Date())
const viewType = ref<CalendarViewType>(viewFromQuery(unref(route).query.view) || config.defaultView)

const visibleEvents = computed(() => getVisibleEvents(calendars.value as any))

// Reminders of the loaded events while the app is open
useReminders(visibleEvents)

function syncRouteQuery() {
  const view = viewToQuery(viewType.value)
  const date = dateToQuery(currentDate.value)
  const { query } = unref(route)
  if (query.view === view && query.date === date) return
  replaceRoute((query, hash) => [{ ...query, view, date }, hash])
}

watch([viewType, currentDate], syncRouteQuery)

// Follow changes of the route made from outside (e.g. an edited URL). Runs synchronously so our
// own, still pending route updates can be told apart and don't reset newer local state.
watch(
  () => [unref(route).query.view, unref(route).query.date] as const,
  ([view, date]) => {
    if (pendingRouteUpdates > 0) return
    const newView = viewFromQuery(view)
    if (newView && newView !== viewType.value) {
      viewType.value = newView
    }
    const newDate = dateFromQuery(date)
    if (newDate && dateToQuery(newDate) !== dateToQuery(currentDate.value)) {
      currentDate.value = newDate
    }
  },
  { flush: 'sync' }
)

// Invite links opened while the calendar is already shown
let initialLoadDone = false
watch(
  () => [unref(route).query, unref(route).hash] as const,
  () => {
    if (initialLoadDone && !pendingJoinInvite.value) checkJoinInvite()
  }
)

onMounted(async () => {
  syncRouteQuery()
  await loadCalendars()
  await loadEventsForCurrentRange()
  initialLoadDone = true
  checkJoinInvite()
})

watch(
  () => calendars.value.map((c) => c.href).join(','),
  () => {
    // When the list of calendars changes (e.g. shared calendars loaded), re-fetch events
    loadEventsForCurrentRange()
  }
)

watch(
  () => calendars.value.map((c) => c.visible).join(','),
  () => {
    // Visibility changed, events will be filtered by visibleEvents computed
  }
)

async function loadEventsForCurrentRange() {
  const range = getExtendedRange(currentDate.value)
  await fetchEvents(calendars.value as any, range)
}

function handlePrev() {
  calendarViewRef.value?.prev()
}

function handleNext() {
  calendarViewRef.value?.next()
}

function handleToday() {
  calendarViewRef.value?.today()
  currentDate.value = new Date()
}

function handleViewChange(view: CalendarViewType) {
  viewType.value = view
}

function handleDateChange(date: Date) {
  currentDate.value = date
  loadEventsForCurrentRange()
}

function handleToggleCalendar(href: string) {
  toggleCalendarVisibility(href)
}

function handleEventClick(event: CalendarEvent) {
  openEdit(event)
}

function handleDateSelect(start: Date, end: Date, allDay: boolean) {
  const defaultCalendar = getDefaultCalendar()
  if (defaultCalendar) {
    openCreate(defaultCalendar.href, start, end, allDay)
  }
}

async function handleEventDrop(event: CalendarEvent, start: Date, end: Date) {
  const client = getCalDAVClient()
  try {
    if (event.isRecurring && event.recurrenceId) {
      // Drag-drop a recurring instance: create exception for this occurrence
      await client.updateEventOccurrence(event, event.recurrenceId, {
        uid: event.uid,
        calendarHref: event.calendarHref,
        summary: event.summary,
        start,
        end,
        allDay: event.allDay,
        description: event.description || '',
        location: event.location || ''
      })
      await loadEventsForCurrentRange()
    } else {
      const updated = await client.updateEvent(event, {
        uid: event.uid,
        calendarHref: event.calendarHref,
        summary: event.summary,
        start,
        end,
        allDay: event.allDay,
        description: event.description || '',
        location: event.location || ''
      })
      updateEventInCache(updated)
    }
  } catch (err) {
    console.error('Failed to update event:', err)
    showError($gettext('Failed to move event'), err)
    await loadEventsForCurrentRange()
  }
}

async function handleEventSaved() {
  await loadEventsForCurrentRange()
}

async function handleEventDeleted() {
  await loadEventsForCurrentRange()
}

function handleCreateCalendar() {
  openCalendarEditor()
}

function handleDeleteCalendar(calendarHref: string) {
  const calendar = calendars.value.find((c) => c.href === calendarHref)
  if (!calendar) return

  const leave = !!calendar.isShared
  const name = calendar.displayName
  dispatchModal({
    title: leave ? $gettext('Leave Calendar') : $gettext('Delete Calendar'),
    message: leave
      ? $gettext(
          "Are you sure you want to leave '%{name}'? You will no longer have access to this calendar.",
          { name }
        )
      : $gettext(
          "Are you sure you want to delete '%{name}'? All events in this calendar will be permanently deleted.",
          { name }
        ),
    confirmText: leave ? $gettext('Leave') : $gettext('Delete'),
    onConfirm: async () => {
      // Failures are reported by `leaveCalendar` / `deleteCalendar`
      const success = leave ? await leaveCalendar(calendar) : await deleteCalendar(calendarHref)
      if (success) {
        // Reload events to remove events from deleted/left calendar
        await loadEventsForCurrentRange()
      }
    }
  })
}

function handleShareCalendar(calendarHref: string) {
  const calendar = calendars.value.find((c) => c.href === calendarHref)
  if (calendar) {
    sharingCalendar.value = calendar
  }
}

async function handleCalendarSaved() {
  await loadCalendars()
}

function handleImportCalendar() {
  openImport()
}

async function handleImported() {
  await loadCalendars()
  await loadEventsForCurrentRange()
}

// Dialogs, shown as OpenCloud modals (`useModals`)
useEventDialogs({
  calendars: () => calendars.value,
  onSaved: handleEventSaved,
  onDeleted: handleEventDeleted
})

useModalBinding({
  open: () => calendarEditorOpen.value,
  title: () => $gettext('New Calendar'),
  modal: () => ({
    customComponent: CalendarDialog,
    customComponentAttrs: () => ({
      calendarHomeUrl: calendarHomeUrl.value,
      onSaved: handleCalendarSaved
    }),
    confirmText: $gettext('Create'),
    confirmDisabled: true,
    focusTrapInitial: '#calendar-name',
    onCancel: closeCalendarEditor
  })
})

useModalBinding({
  open: () => importOpen.value,
  title: () => $gettext('Import Calendar'),
  modal: () => ({
    customComponent: ICSImportDialog,
    customComponentAttrs: () => ({
      calendars: calendars.value,
      calendarHomeUrl: calendarHomeUrl.value,
      defaultCalendar: getDefaultCalendar() || null,
      onImported: handleImported
    }),
    // The footer buttons are rendered by the component, the import keeps the modal open
    hideConfirmButton: true,
    onCancel: closeImport
  })
})

useModalBinding({
  open: () => !!sharingCalendar.value,
  title: () =>
    $gettext('Share calendar: %{name}', { name: sharingCalendar.value?.displayName ?? '' }),
  modal: () => {
    const calendar = sharingCalendar.value
    return {
      customComponent: CalendarSharingDialog,
      customComponentAttrs: () => ({ calendar }),
      hideConfirmButton: true,
      elementClass: 'ext:max-w-2xl!',
      onCancel: () => {
        sharingCalendar.value = null
      }
    }
  }
})

useModalBinding({
  open: () => !!pendingJoinInvite.value,
  title: () => $gettext('Join Shared Calendar'),
  modal: () => {
    const inviteData = pendingJoinInvite.value
    return {
      customComponent: InviteJoinDialog,
      customComponentAttrs: () => ({ inviteData }),
      confirmText: $gettext('Join Calendar'),
      onConfirm: handleJoinCalendar,
      onCancel: handleCancelJoin
    }
  }
})
</script>

<template>
  <div class="ext:flex ext:flex-col ext:h-full ext:bg-role-surface ext:text-role-on-surface">
    <CalendarToolbar
      :current-date="currentDate"
      :view-type="viewType"
      :sidebar-open="sidebarOpen"
      @prev="handlePrev"
      @next="handleNext"
      @today="handleToday"
      @change-view="handleViewChange"
      @toggle-sidebar="toggleSidebar"
    />

    <div class="ext:flex ext:flex-1 ext:overflow-hidden ext:relative">
      <!-- Mobile sidebar backdrop -->
      <div
        v-if="sidebarOpen"
        class="ext:sm:hidden ext:absolute ext:inset-0 ext:z-10 ext:bg-role-scrim/30"
        aria-hidden="true"
        @click="sidebarOpen = false"
      />

      <CalendarSidebar
        :calendars="calendars"
        :pending-shares="pendingShares"
        :user-profiles="userProfiles"
        :loading="calendarsLoading"
        :is-open="sidebarOpen"
        @toggle="handleToggleCalendar"
        @create="handleCreateCalendar"
        @delete="handleDeleteCalendar"
        @share="handleShareCalendar"
        @import="handleImportCalendar"
        @accept-share="acceptShare"
        @decline-share="declineShare"
        @refresh="loadCalendars"
      />

      <CalendarView
        ref="calendarViewRef"
        :events="visibleEvents"
        :calendars="calendars"
        :current-date="currentDate"
        :view-type="viewType"
        @date-change="handleDateChange"
        @event-click="handleEventClick"
        @date-select="handleDateSelect"
        @event-drop="handleEventDrop"
      />
    </div>
  </div>
</template>

<style>
/*
 * Destructive actions (delete, remove, revoke). The design system has no error color role for
 * buttons, so the role is mapped onto the button's color variable. Used inside the modals, which
 * are rendered outside of this view, hence not scoped.
 */
.web-calendar-danger-button.oc-button {
  --oc-button-color: var(--oc-role-error);
}
</style>
