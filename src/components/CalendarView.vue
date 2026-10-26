<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import type {
  CalendarOptions,
  EventInput,
  EventClickArg,
  DateSelectArg,
  EventDropArg,
  DatesSetArg
} from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import type { CalendarEvent, Calendar } from '../types/calendar'
import { useFullCalendarLocale } from '../composables/useFullCalendarLocale'
import { useCalendarConfig, type CalendarViewType } from '../config'
import { AGENDA_DAYS } from '../utils/new-event'

const props = defineProps<{
  events: CalendarEvent[]
  calendars: readonly Calendar[]
  currentDate: Date
  viewType: CalendarViewType
}>()

const emit = defineEmits<{
  'date-change': [date: Date]
  'view-change': [view: CalendarViewType]
  'event-click': [event: CalendarEvent]
  'date-select': [start: Date, end: Date, allDay: boolean]
  'event-drop': [event: CalendarEvent, start: Date, end: Date]
}>()

const { firstDayOfWeek } = useCalendarConfig()
// Follows the OpenCloud language (button texts, "all-day", "+n more", first day of the week)
const locale = useFullCalendarLocale()

const calendarRef = ref<InstanceType<typeof FullCalendar> | null>(null)
const lastEmittedDate = ref<number>(0)

const calendarColorMap = computed(() => {
  const map = new Map<string, string>()
  for (const cal of props.calendars) {
    map.set(cal.href, cal.color)
  }
  return map
})

const fullCalendarEvents = computed<EventInput[]>(() => {
  return props.events.map((event) => {
    const calendar = props.calendars.find((c) => c.href === event.calendarHref)
    const isReadOnly = calendar?.readOnly || false

    return {
      id: event.recurrenceId ? `${event.uid}_${event.recurrenceId}` : event.uid,
      title: event.summary,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      backgroundColor: calendarColorMap.value.get(event.calendarHref) || '#3788d8',
      borderColor: calendarColorMap.value.get(event.calendarHref) || '#3788d8',
      editable: !isReadOnly,
      extendedProps: {
        calendarEvent: event,
        isReadOnly
      }
    }
  })
})

/**
 * Agenda: a list of the next days starting at the current date, prev/next move by that many
 * days. Times are shown in the list, unlike in the grids.
 */
const AGENDA_VIEWS: CalendarOptions['views'] = {
  listAgenda: {
    type: 'list',
    duration: { days: AGENDA_DAYS },
    displayEventTime: true
  }
}

const calendarOptions = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
  initialView: props.viewType,
  views: AGENDA_VIEWS,
  initialDate: props.currentDate,
  headerToolbar: false,
  locale: locale.value,
  // Without a configured value the first day of the week is derived from the locale
  ...(firstDayOfWeek !== null && { firstDay: firstDayOfWeek }),
  events: fullCalendarEvents.value,
  editable: true,
  selectable: true,
  selectMirror: true,
  dayMaxEvents: true,
  weekends: true,
  nowIndicator: true,
  displayEventTime: false,
  eventClick: handleEventClick,
  select: handleDateSelect,
  eventDrop: handleEventDrop,
  eventResize: handleEventResize,
  datesSet: handleDatesSet
}))

function handleEventClick(info: EventClickArg) {
  const calendarEvent = info.event.extendedProps.calendarEvent as CalendarEvent
  emit('event-click', calendarEvent)
}

function handleDateSelect(info: DateSelectArg) {
  emit('date-select', info.start, info.end, info.allDay)
}

function handleEventDrop(info: EventDropArg) {
  const calendarEvent = info.event.extendedProps.calendarEvent as CalendarEvent
  emit('event-drop', calendarEvent, info.event.start!, info.event.end || info.event.start!)
}

function handleEventResize(info: EventResizeDoneArg) {
  const calendarEvent = info.event.extendedProps.calendarEvent as CalendarEvent
  emit('event-drop', calendarEvent, info.event.start!, info.event.end || info.event.start!)
}

function handleDatesSet(info: DatesSetArg) {
  const dateTime = info.view.currentStart.getTime()
  if (dateTime !== lastEmittedDate.value) {
    lastEmittedDate.value = dateTime
    emit('date-change', info.view.currentStart)
  }
}

watch(
  () => props.viewType,
  (newView) => {
    const api = calendarRef.value?.getApi()
    if (api) {
      api.changeView(newView)
    }
  }
)

watch(
  () => props.currentDate,
  (newDate) => {
    const api = calendarRef.value?.getApi()
    if (api && newDate.getTime() !== lastEmittedDate.value) {
      api.gotoDate(newDate)
    }
  }
)

function goToDate(date: Date) {
  const api = calendarRef.value?.getApi()
  if (api) {
    api.gotoDate(date)
  }
}

function prev() {
  const api = calendarRef.value?.getApi()
  if (api) {
    api.prev()
  }
}

function next() {
  const api = calendarRef.value?.getApi()
  if (api) {
    api.next()
  }
}

function today() {
  const api = calendarRef.value?.getApi()
  if (api) {
    api.today()
  }
}

function updateSize() {
  calendarRef.value?.getApi().updateSize()
}

defineExpose({
  updateSize,
  goToDate,
  prev,
  next,
  today
})
</script>

<template>
  <div class="web-calendar-view ext:flex-1 ext:overflow-auto">
    <FullCalendar ref="calendarRef" :options="calendarOptions" class="ext:h-full" />
  </div>
</template>

<style>
/*
 * Themes FullCalendar with the OpenCloud color roles, so it follows the active theme and color
 * scheme without any detection. Everything is scoped to the calendar root so it can't leak into
 * other apps.
 */
.web-calendar-view {
  --fc-page-bg-color: var(--oc-role-surface);
  --fc-neutral-bg-color: var(--oc-role-surface-container);
  --fc-neutral-text-color: var(--oc-role-on-surface-variant);
  --fc-border-color: var(--oc-role-outline-variant);
  --fc-today-bg-color: var(--oc-role-primary-container);
  --fc-now-indicator-color: var(--oc-role-error);
  --fc-highlight-color: color-mix(in srgb, var(--oc-role-primary) 20%, transparent);
  --fc-non-business-color: color-mix(in srgb, var(--oc-role-surface-container) 50%, transparent);
  --fc-list-event-hover-bg-color: var(--oc-role-surface-container);
  --fc-button-text-color: var(--oc-role-on-primary);
  --fc-button-bg-color: var(--oc-role-primary);
  --fc-button-border-color: var(--oc-role-primary);
  --fc-button-hover-bg-color: var(--oc-role-primary-container);
  --fc-button-hover-border-color: var(--oc-role-primary-container);
  --fc-button-active-bg-color: var(--oc-role-primary-container);
  --fc-button-active-border-color: var(--oc-role-primary-container);
}

.web-calendar-view .fc {
  height: 100%;
  background-color: var(--oc-role-surface);
  color: var(--oc-role-on-surface);
}

.web-calendar-view .fc-theme-standard td,
.web-calendar-view .fc-theme-standard th,
.web-calendar-view .fc-theme-standard .fc-scrollgrid {
  border-color: var(--oc-role-outline-variant);
}

.web-calendar-view .fc .fc-button-primary:disabled {
  background-color: var(--oc-role-outline);
  border-color: var(--oc-role-outline);
}

.web-calendar-view .fc-event {
  cursor: pointer;
}

.web-calendar-view .fc-daygrid-day-number {
  padding: 4px 8px;
  color: var(--oc-role-on-surface);
}

.web-calendar-view .fc-col-header-cell-cushion {
  padding: 8px;
  color: var(--oc-role-on-surface-variant);
}

.web-calendar-view .fc-daygrid-day {
  background-color: var(--oc-role-surface);
}

.web-calendar-view .fc-day-today .fc-daygrid-day-number {
  color: var(--oc-role-on-primary-container);
}

.web-calendar-view .fc-daygrid-day-top {
  color: var(--oc-role-on-surface);
}

.web-calendar-view .fc-timegrid-slot-label {
  color: var(--oc-role-on-surface-variant);
}

.web-calendar-view .fc-list-day-cushion {
  background-color: var(--oc-role-surface-container);
  color: var(--oc-role-on-surface);
}

/* Timegrid axis and slots */
.web-calendar-view .fc .fc-timegrid-axis {
  background-color: var(--oc-role-surface);
}

.web-calendar-view .fc .fc-timegrid-slot {
  border-color: var(--oc-role-outline-variant);
}

/* Column header background */
.web-calendar-view .fc .fc-col-header-cell {
  background-color: var(--oc-role-surface-container);
}

/* Day grid "more" link */
.web-calendar-view .fc .fc-more-link {
  color: var(--oc-role-primary);
}

/* Now indicator */
.web-calendar-view .fc .fc-timegrid-now-indicator-line {
  border-color: var(--oc-role-error);
}

/* List (agenda) view */
.web-calendar-view .fc .fc-list {
  border-color: var(--oc-role-outline-variant);
}

.web-calendar-view .fc .fc-list-day-cushion,
.web-calendar-view .fc .fc-list-day-text,
.web-calendar-view .fc .fc-list-day-side-text {
  color: var(--oc-role-on-surface);
}

.web-calendar-view .fc .fc-list-event-time {
  color: var(--oc-role-on-surface-variant);
}

.web-calendar-view .fc .fc-list-event:hover td {
  background-color: var(--oc-role-surface-container);
}

.web-calendar-view .fc .fc-list-empty {
  background-color: var(--oc-role-surface);
  color: var(--oc-role-on-surface-variant);
}

/* Popover ("+2 more" events popup) */
.web-calendar-view .fc .fc-popover {
  background-color: var(--oc-role-surface-container);
  border-color: var(--oc-role-outline-variant);
}

.web-calendar-view .fc .fc-popover-header {
  background-color: var(--oc-role-surface-container-high);
  color: var(--oc-role-on-surface);
}
</style>
