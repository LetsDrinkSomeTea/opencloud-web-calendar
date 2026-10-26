<!-- eslint-disable vue/multi-word-component-names -- route view loaded only via the router, never used as a tag; the file name is referenced in index.ts and the roadmap -->
<script setup lang="ts">
import { ref, computed, onMounted, watch, unref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useRoute, useRouter } from '@opencloud-eu/web-pkg'
import type { LocationQuery } from 'vue-router'
import CalendarToolbar from '../components/CalendarToolbar.vue'
import CalendarSidebar from '../components/CalendarSidebar.vue'
import CalendarView from '../components/CalendarView.vue'
import EventDialog from '../components/EventDialog.vue'
import CalendarDialog from '../components/CalendarDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ICSImportDialog from '../components/ICSImportDialog.vue'
import CalendarSharingDialog from '../components/CalendarSharingDialog.vue'
import InviteJoinDialog, { type InviteData } from '../components/InviteJoinDialog.vue'
import { useCalendars } from '../composables/useCalendars'
import { useEvents } from '../composables/useEvents'
import { useEventEditor } from '../composables/useEventEditor'
import { useCalendarEditor } from '../composables/useCalendarEditor'
import { useTheme } from '../composables/useTheme'
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
const { open: openCalendarEditor } = useCalendarEditor()
const importDialogRef = ref<InstanceType<typeof ICSImportDialog> | null>(null)
// Called for its side effect: keeps the data-calendar-theme attribute in sync
useTheme()

const sidebarOpen = ref(false)

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

// Confirmation dialog state
const confirmAction = ref<{
  type: 'delete' | 'leave'
  isOpen: boolean
  calendarHref: string
  calendarName: string
  calendar?: Calendar
} | null>(null)

// Built in the script: the messages contain quotes that cannot be nested in a template attribute
const confirmMessage = computed(() => {
  const name = confirmAction.value?.calendarName || ''
  return confirmAction.value?.type === 'leave'
    ? $gettext(
        "Are you sure you want to leave '%{name}'? You will no longer have access to this calendar.",
        { name }
      )
    : $gettext(
        "Are you sure you want to delete '%{name}'? All events in this calendar will be permanently deleted.",
        { name }
      )
})

// Sharing dialog state
const sharingCalendar = ref<Calendar | null>(null)

// Invite Join dialog state
const pendingJoinInvite = ref<InviteData | null>(null)
const joinLoading = ref(false)
const toastMessage = ref<string | null>(null)
let toastTimeout: ReturnType<typeof setTimeout> | null = null

function showToast(message: string) {
  toastMessage.value = message
  if (toastTimeout) clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => {
    toastMessage.value = null
  }, 3500)
}

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
    showToast($gettext('You are already subscribed to this calendar.'))
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
  joinLoading.value = true
  try {
    const success = await joinCalendarViaInvite(pendingJoinInvite.value)
    if (success) {
      showToast($gettext('Joined calendar successfully'))
      await loadEventsForCurrentRange()
    }
  } catch (e) {
    console.error('Failed to join calendar:', e)
  } finally {
    joinLoading.value = false
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
  if (calendar) {
    confirmAction.value = {
      type: calendar.isShared ? 'leave' : 'delete',
      isOpen: true,
      calendarHref,
      calendarName: calendar.displayName,
      calendar
    }
  }
}

function handleShareCalendar(calendarHref: string) {
  const calendar = calendars.value.find((c) => c.href === calendarHref)
  if (calendar) {
    sharingCalendar.value = calendar
  }
}

async function confirmCalendarAction() {
  if (!confirmAction.value) return

  let success = false
  if (confirmAction.value.type === 'leave' && confirmAction.value.calendar) {
    success = await leaveCalendar(confirmAction.value.calendar)
  } else {
    success = await deleteCalendar(confirmAction.value.calendarHref)
  }

  if (success) {
    // Reload events to remove events from deleted/left calendar
    await loadEventsForCurrentRange()
  }
  confirmAction.value = null
}

function cancelCalendarAction() {
  confirmAction.value = null
}

async function handleCalendarSaved() {
  await loadCalendars()
}

function handleImportCalendar() {
  importDialogRef.value?.open()
}

async function handleImported() {
  await loadCalendars()
  await loadEventsForCurrentRange()
}
</script>

<template>
  <div class="ext:flex ext:flex-col ext:h-full ext:bg-white">
    <CalendarToolbar
      :current-date="currentDate"
      :view-type="viewType"
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
        class="sm:ext:hidden ext:absolute ext:inset-0 ext:z-10 ext:bg-black/30"
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

    <EventDialog :calendars="calendars" @saved="handleEventSaved" @deleted="handleEventDeleted" />

    <CalendarDialog :calendar-home-url="calendarHomeUrl" @saved="handleCalendarSaved" />

    <ICSImportDialog
      ref="importDialogRef"
      :calendars="calendars"
      :calendar-home-url="calendarHomeUrl"
      :default-calendar="getDefaultCalendar() || null"
      @imported="handleImported"
    />

    <CalendarSharingDialog
      v-if="sharingCalendar"
      :calendar="sharingCalendar"
      :is-open="!!sharingCalendar"
      @close="sharingCalendar = null"
    />

    <ConfirmDialog
      :is-open="confirmAction?.isOpen || false"
      :title="
        confirmAction?.type === 'leave' ? $gettext('Leave Calendar') : $gettext('Delete Calendar')
      "
      :message="confirmMessage"
      :confirm-text="confirmAction?.type === 'leave' ? $gettext('Leave') : $gettext('Delete')"
      :confirm-danger="true"
      @confirm="confirmCalendarAction"
      @cancel="cancelCalendarAction"
    />

    <InviteJoinDialog
      :is-open="!!pendingJoinInvite"
      :invite-data="pendingJoinInvite"
      :loading="joinLoading"
      @join="handleJoinCalendar"
      @close="handleCancelJoin"
    />

    <!-- Toast Notification -->
    <div
      v-if="toastMessage"
      class="ext:fixed ext:bottom-6 ext:right-6 ext:z-50 ext:bg-gray-900/90 ext:text-white ext:px-4 ext:py-2.5 ext:rounded-lg ext:shadow-lg ext:text-sm ext:flex ext:items-center ext:gap-2 ext:backdrop-blur-sm"
    >
      <svg
        class="ext:w-4 ext:h-4 ext:text-green-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
      <span>{{ toastMessage }}</span>
    </div>
  </div>
</template>

<style>
/* ============================================================
   Dark mode overrides
   Uses OpenCloud's --oc-role-* CSS variables that are set on
   document.documentElement and switch automatically with theme.
   ============================================================ */

/* --- Backgrounds --- */
[data-calendar-theme='dark'] .ext\:bg-white {
  background-color: var(--oc-role-surface) !important;
}
[data-calendar-theme='dark'] .ext\:bg-gray-50 {
  background-color: var(--oc-role-surface-container) !important;
}
[data-calendar-theme='dark'] .ext\:bg-gray-100 {
  background-color: var(--oc-role-surface-container-high) !important;
}
[data-calendar-theme='dark'] .ext\:bg-gray-200 {
  background-color: var(--oc-role-surface-container-high) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:bg-gray-50:hover {
  background-color: var(--oc-role-surface-container-high) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:bg-gray-100:hover {
  background-color: var(--oc-role-surface-container-highest) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:bg-gray-200:hover {
  background-color: var(--oc-role-surface-container-highest) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:bg-gray-300:hover {
  background-color: var(--oc-role-surface-container-highest) !important;
}

/* --- Text colors --- */
[data-calendar-theme='dark'] .ext\:text-gray-900 {
  color: var(--oc-role-on-surface) !important;
}
[data-calendar-theme='dark'] .ext\:text-gray-700 {
  color: var(--oc-role-on-surface-variant) !important;
}
[data-calendar-theme='dark'] .ext\:text-gray-600 {
  color: var(--oc-role-outline) !important;
}
[data-calendar-theme='dark'] .ext\:text-gray-500 {
  color: var(--oc-role-outline) !important;
}
[data-calendar-theme='dark'] .ext\:text-gray-400 {
  color: var(--oc-role-outline) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:text-gray-700:hover {
  color: var(--oc-role-on-surface) !important;
}

/* --- Borders --- */
[data-calendar-theme='dark'] .ext\:border-gray-200 {
  border-color: var(--oc-role-outline-variant) !important;
}
[data-calendar-theme='dark'] .ext\:border-gray-300 {
  border-color: var(--oc-role-outline-variant) !important;
}
[data-calendar-theme='dark'] .ext\:border-gray-900 {
  border-color: var(--oc-role-on-surface) !important;
}
[data-calendar-theme='dark'] .ext\:border-b {
  border-color: var(--oc-role-outline-variant);
}
[data-calendar-theme='dark'] .ext\:border-t {
  border-color: var(--oc-role-outline-variant);
}
[data-calendar-theme='dark'] .ext\:border-r {
  border-color: var(--oc-role-outline-variant);
}

/* --- Primary / Blue --- */
[data-calendar-theme='dark'] .ext\:bg-blue-500 {
  background-color: var(--oc-role-primary) !important;
}
[data-calendar-theme='dark'] .ext\:bg-blue-600 {
  background-color: var(--oc-role-primary) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:bg-blue-700:hover {
  background-color: var(--oc-role-primary-container) !important;
  color: var(--oc-role-on-primary-container) !important;
}
[data-calendar-theme='dark'] .ext\:text-blue-600 {
  color: var(--oc-role-primary) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:bg-blue-50:hover {
  background-color: var(--oc-role-primary-container) !important;
}
[data-calendar-theme='dark'] .ext\:border-blue-200 {
  border-color: var(--oc-role-primary-container) !important;
}
[data-calendar-theme='dark'] .ext\:border-blue-600 {
  border-color: var(--oc-role-primary) !important;
}
[data-calendar-theme='dark'] .ext\:bg-blue-600.ext\:text-white {
  background-color: var(--oc-role-primary) !important;
  color: var(--oc-role-on-primary) !important;
}

/* --- Focus rings --- */
[data-calendar-theme='dark'] .ext\:focus\:ring-blue-500:focus {
  --tw-ring-color: var(--oc-role-primary) !important;
}
[data-calendar-theme='dark'] .ext\:focus\:border-blue-500:focus {
  border-color: var(--oc-role-primary) !important;
}

/* --- Error / Red --- */
[data-calendar-theme='dark'] .ext\:text-red-600 {
  color: var(--oc-role-error) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:text-red-600:hover {
  color: var(--oc-role-error) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:text-red-800:hover {
  color: var(--oc-role-error) !important;
}
[data-calendar-theme='dark'] .ext\:bg-red-600 {
  background-color: var(--oc-role-error-container) !important;
  color: var(--oc-role-on-error-container) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:bg-red-700:hover {
  background-color: var(--oc-role-error) !important;
}

/* --- Warning / Yellow (conflict resolution) --- */
[data-calendar-theme='dark'] .ext\:bg-yellow-50 {
  background-color: var(--oc-role-surface-container-high) !important;
}
[data-calendar-theme='dark'] .ext\:border-yellow-200 {
  border-color: var(--oc-role-outline-variant) !important;
}
[data-calendar-theme='dark'] .ext\:text-yellow-800 {
  color: var(--oc-role-on-surface) !important;
}
[data-calendar-theme='dark'] .ext\:bg-yellow-600 {
  background-color: var(--oc-role-primary) !important;
}
[data-calendar-theme='dark'] .hover\:ext\:bg-yellow-700:hover {
  background-color: var(--oc-role-primary-container) !important;
}

/* --- Inputs (inside dark theme) --- */
[data-calendar-theme='dark'] input,
[data-calendar-theme='dark'] select,
[data-calendar-theme='dark'] textarea {
  background-color: var(--oc-role-surface-container-low) !important;
  color: var(--oc-role-on-surface) !important;
  border-color: var(--oc-role-outline-variant) !important;
}
[data-calendar-theme='dark'] input[type='checkbox'],
[data-calendar-theme='dark'] input[type='radio'] {
  background-color: var(--oc-role-surface-container-low) !important;
  accent-color: var(--oc-role-primary) !important;
}
[data-calendar-theme='dark'] input::placeholder,
[data-calendar-theme='dark'] textarea::placeholder {
  color: var(--oc-role-outline) !important;
}
[data-calendar-theme='dark'] option {
  background-color: var(--oc-role-surface-container) !important;
  color: var(--oc-role-on-surface) !important;
}

/* --- Dialog shadows --- */
[data-calendar-theme='dark'] .ext\:shadow-xl,
[data-calendar-theme='dark'] .ext\:shadow-lg {
  --tw-shadow-color: rgba(0, 0, 0, 0.5) !important;
}
</style>
