<script setup lang="ts">
import { computed, useId, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { modalActionsTarget, type Modal } from '@opencloud-eu/web-pkg'
import { useEventEditor } from '../composables/useEventEditor'
import type { Calendar, RecurrenceFormData } from '../types/calendar'
import { formatDateForInput, formatTimeForInput } from '../utils/date'
import { generateICS } from '../caldav/ics-utils'
import { toInvitationICS } from '../caldav/attendees'
import EventReminders from './EventReminders.vue'
import EventAttendees from './EventAttendees.vue'
import { useLocationSearch } from '../composables/useLocationSearch'
import { translateError } from '../utils/error-message'
import { downloadICS, safeFileName } from '../utils/download'
import FreeBusyHint from './FreeBusyHint.vue'

/**
 * Content of the event modal (dispatched via `useModals`, see `useEventDialogs`).
 * The footer buttons are teleported into the modal's actions row.
 */
const props = defineProps<{
  modal: Modal
  calendars: readonly Calendar[]
}>()

const emit = defineEmits<{
  saved: []
  deleted: []
  confirm: []
  cancel: []
}>()

const {
  isEditing,
  editingEvent,
  formData,
  saving,
  error,
  conflictData,
  editScope,
  save,
  deleteEvent,
  resolveConflictKeepLocal,
  resolveConflictUseServer
} = useEventEditor()

const {
  results: locationResults,
  loading: searchingLocation,
  search: searchLocation,
  clearResults: clearLocationResults
} = useLocationSearch()

const { $gettext, $ngettext } = useGettext()

const formId = `web-calendar-event-form-${useId()}`
const locationListId = `web-calendar-location-results-${useId()}`

function handleLocationInput(value: string) {
  searchLocation(value)
}

function selectLocation(displayName: string) {
  formData.value.location = displayName
  clearLocationResults()
}

function handleLocationBlur() {
  // Delay clearing results to allow click event on dropdown to fire
  setTimeout(() => {
    clearLocationResults()
  }, 200)
}

const weekdays = computed(() => [
  { value: 'MO', label: $gettext('Mon') },
  { value: 'TU', label: $gettext('Tue') },
  { value: 'WE', label: $gettext('Wed') },
  { value: 'TH', label: $gettext('Thu') },
  { value: 'FR', label: $gettext('Fri') },
  { value: 'SA', label: $gettext('Sat') },
  { value: 'SU', label: $gettext('Sun') }
])

const hasRecurrence = computed({
  get: () => !!formData.value.recurrence,
  set: (val: boolean) => {
    if (val) {
      formData.value.recurrence = {
        frequency: 'WEEKLY',
        interval: 1,
        endType: 'never'
      }
    } else {
      formData.value.recurrence = undefined
    }
  }
})

const recurrenceFrequency = computed({
  get: () => formData.value.recurrence?.frequency || 'WEEKLY',
  set: (val: RecurrenceFormData['frequency']) => {
    if (formData.value.recurrence) {
      formData.value.recurrence = { ...formData.value.recurrence, frequency: val }
    }
  }
})

const recurrenceInterval = computed({
  get: () => formData.value.recurrence?.interval || 1,
  set: (val: number) => {
    if (formData.value.recurrence) {
      formData.value.recurrence = { ...formData.value.recurrence, interval: val }
    }
  }
})

const frequencyOptions = computed<{ value: RecurrenceFormData['frequency']; label: string }[]>(
  () => [
    { value: 'DAILY', label: $ngettext('day', 'days', recurrenceInterval.value) },
    { value: 'WEEKLY', label: $ngettext('week', 'weeks', recurrenceInterval.value) },
    { value: 'MONTHLY', label: $ngettext('month', 'months', recurrenceInterval.value) },
    { value: 'YEARLY', label: $ngettext('year', 'years', recurrenceInterval.value) }
  ]
)

const recurrenceEndType = computed({
  get: () => formData.value.recurrence?.endType || 'never',
  set: (val: RecurrenceFormData['endType']) => {
    if (formData.value.recurrence) {
      formData.value.recurrence = { ...formData.value.recurrence, endType: val }
    }
  }
})

const recurrenceCount = computed({
  get: () => formData.value.recurrence?.count || 10,
  set: (val: number) => {
    if (formData.value.recurrence) {
      formData.value.recurrence = { ...formData.value.recurrence, count: val }
    }
  }
})

const recurrenceUntil = computed({
  get: () => {
    const d = formData.value.recurrence?.until
    return d ? formatDateForInput(d) : ''
  },
  set: (val: string) => {
    if (formData.value.recurrence && val) {
      formData.value.recurrence = {
        ...formData.value.recurrence,
        until: new Date(val + 'T23:59:59')
      }
    }
  }
})

/** Number inputs report strings; incomplete input (e.g. an empty field) keeps the last value */
function parseNumber(value: string, apply: (n: number) => void) {
  const n = parseInt(value, 10)
  if (!Number.isNaN(n)) {
    apply(n)
  }
}

function isWeekdaySelected(day: string): boolean {
  return formData.value.recurrence?.byDay?.includes(day) || false
}

function toggleWeekday(day: string) {
  if (!formData.value.recurrence) return
  const current = formData.value.recurrence.byDay || []
  const newDays = current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
  formData.value.recurrence = {
    ...formData.value.recurrence,
    byDay: newDays.length > 0 ? newDays : undefined
  }
}

const startDate = computed({
  get: () => formatDateForInput(formData.value.start),
  set: (val: string) => {
    const newDate = new Date(val + 'T' + formatTimeForInput(formData.value.start))
    formData.value.start = newDate
  }
})

const startTime = computed({
  get: () => formatTimeForInput(formData.value.start),
  set: (val: string) => {
    const newDate = new Date(formatDateForInput(formData.value.start) + 'T' + val)
    formData.value.start = newDate
  }
})

const endDate = computed({
  get: () => formatDateForInput(formData.value.end),
  set: (val: string) => {
    const newDate = new Date(val + 'T' + formatTimeForInput(formData.value.end))
    formData.value.end = newDate
  }
})

const endTime = computed({
  get: () => formatTimeForInput(formData.value.end),
  set: (val: string) => {
    const newDate = new Date(formatDateForInput(formData.value.end) + 'T' + val)
    formData.value.end = newDate
  }
})

watch(
  () => formData.value.allDay,
  (allDay) => {
    if (allDay) {
      const start = new Date(formData.value.start)
      start.setHours(0, 0, 0, 0)
      formData.value.start = start

      const end = new Date(formData.value.end)
      end.setHours(23, 59, 59, 999)
      formData.value.end = end
    }
  }
)

const writableCalendars = computed(() => {
  return props.calendars.filter((cal) => !cal.readOnly)
})

const isReadOnly = computed(() => {
  const calendar = props.calendars.find((c) => c.href === formData.value.calendarHref)
  return calendar?.readOnly || false
})

const busy = computed(() => saving.value || !!props.modal.isLoading)

const canSave = computed(() => !busy.value && !isReadOnly.value && !!formData.value.summary?.trim())

/** Routed through the modal wrapper, which shows the loading state and closes the modal */
function handleSubmit() {
  if (!canSave.value) return
  emit('confirm')
}

/** Called by the modal wrapper on confirm; rejecting keeps the modal open (the error is shown inline) */
async function onConfirm() {
  if (isReadOnly.value) {
    return Promise.reject()
  }
  const result = await save()
  if (!result) {
    return Promise.reject()
  }
  emit('saved')
}

async function handleDelete() {
  if (isReadOnly.value) return
  const success = await deleteEvent()
  if (success) {
    emit('deleted')
  }
}

/** The event as iTIP request (`METHOD:REQUEST`), e.g. to attach it to an email */
function handleDownloadInvitation() {
  const isSeries = editScope.value !== 'single'
  const icsContent = generateICS(
    {
      ...formData.value,
      uid: editingEvent.value?.uid ?? formData.value.uid,
      ...(!isSeries && { recurrence: undefined })
    },
    { sourceICS: editingEvent.value?.icsData }
  )
  downloadICS(toInvitationICS(icsContent), `${formData.value.summary || 'event'}-invitation`)
}

function handleExport() {
  if (!editingEvent.value) return

  let icsContent: string

  if (editScope.value === 'single') {
    // Export only this occurrence as a standalone event (no RRULE)
    icsContent = generateICS({
      ...formData.value,
      uid: editingEvent.value.uid,
      recurrence: undefined
    })
  } else {
    // Export full event or series using raw server ICS data
    icsContent = editingEvent.value.icsData
  }

  downloadICS(icsContent, safeFileName(formData.value.summary, 'event'))
}

defineExpose({ onConfirm })
</script>

<template>
  <div class="web-calendar-event-dialog ext:text-role-on-surface">
    <!-- Conflict Warning -->
    <div
      v-if="conflictData"
      class="ext:mb-4 ext:p-3 ext:rounded ext:bg-role-tertiary-container ext:text-role-on-tertiary-container"
      role="alert"
    >
      <p class="ext:m-0 ext:mb-3 ext:text-sm ext:flex ext:items-start ext:gap-2">
        <oc-icon name="error-warning" fill-type="line" size="small" class="ext:shrink-0" />
        <span>
          {{ $gettext('This event was modified by another client. Choose how to resolve:') }}
        </span>
      </p>
      <div class="ext:flex ext:flex-wrap ext:gap-2">
        <oc-button
          appearance="filled"
          color-role="primary"
          size="small"
          @click="resolveConflictKeepLocal"
        >
          {{ $gettext('Keep my changes') }}
        </oc-button>
        <oc-button size="small" @click="resolveConflictUseServer">
          {{ $gettext('Use server version') }}
        </oc-button>
      </div>
    </div>

    <form :id="formId" class="ext:space-y-4" autocomplete="off" @submit.prevent="handleSubmit">
      <!-- Title -->
      <oc-text-input
        id="event-title"
        v-model="formData.summary"
        :label="$gettext('Title')"
        :placeholder="$gettext('Event title')"
        required-mark
        required
      />

      <!-- Calendar (only for new events) -->
      <oc-select
        v-if="!isEditing"
        id="event-calendar"
        v-model="formData.calendarHref"
        :label="$gettext('Calendar')"
        :options="writableCalendars"
        option-label="displayName"
        :reduce="(cal: Calendar) => cal.href"
        :searchable="false"
        :clearable="false"
        position-fixed
      />

      <!-- All Day -->
      <oc-checkbox id="event-allday" v-model="formData.allDay" :label="$gettext('All day event')" />

      <!-- Start -->
      <div
        :class="formData.allDay ? 'ext:grid ext:grid-cols-1' : 'ext:grid ext:grid-cols-2 ext:gap-4'"
      >
        <oc-text-input
          id="event-start-date"
          v-model="startDate"
          type="date"
          :label="$gettext('Start Date')"
          required
        />
        <div v-if="!formData.allDay">
          <label for="event-start-time" class="ext:inline-block ext:mb-0.5">
            {{ $gettext('Start Time') }}
          </label>
          <input
            id="event-start-time"
            v-model="startTime"
            type="time"
            required
            class="oc-text-input oc-input ext:h-9"
          />
        </div>
      </div>

      <!-- End -->
      <div
        :class="formData.allDay ? 'ext:grid ext:grid-cols-1' : 'ext:grid ext:grid-cols-2 ext:gap-4'"
      >
        <oc-text-input
          id="event-end-date"
          v-model="endDate"
          type="date"
          :label="$gettext('End Date')"
          required
        />
        <div v-if="!formData.allDay">
          <label for="event-end-time" class="ext:inline-block ext:mb-0.5">
            {{ $gettext('End Time') }}
          </label>
          <input
            id="event-end-time"
            v-model="endTime"
            type="time"
            required
            class="oc-text-input oc-input ext:h-9"
          />
        </div>
      </div>

      <FreeBusyHint
        :calendars="calendars"
        :start="formData.start"
        :end="formData.end"
        :all-day="formData.allDay"
        :ignore="editingEvent"
      />

      <!-- Recurrence (hidden when editing single occurrence) -->
      <div v-if="editScope !== 'single'" class="ext:space-y-3">
        <oc-checkbox id="event-repeat" v-model="hasRecurrence" :label="$gettext('Repeat')" />

        <div
          v-if="hasRecurrence"
          class="ext:pl-6 ext:space-y-3 ext:border-l-2 ext:border-role-primary"
        >
          <!-- Frequency + Interval -->
          <div class="ext:flex ext:items-end ext:gap-2">
            <oc-text-input
              id="event-repeat-interval"
              class="ext:w-36"
              type="number"
              inline-label
              :label="$gettext('Every')"
              :model-value="String(recurrenceInterval)"
              min="1"
              max="99"
              @update:model-value="parseNumber($event, (n) => (recurrenceInterval = n))"
            />
            <oc-select
              id="event-repeat-frequency"
              v-model="recurrenceFrequency"
              class="ext:w-36"
              :label="$gettext('Frequency')"
              label-hidden
              :options="frequencyOptions"
              :reduce="(option: { value: string }) => option.value"
              :searchable="false"
              :clearable="false"
              position-fixed
            />
          </div>

          <!-- Weekly: day picker -->
          <div
            v-if="recurrenceFrequency === 'WEEKLY'"
            class="ext:flex ext:flex-wrap ext:gap-1"
            role="group"
            :aria-label="$gettext('Weekdays')"
          >
            <oc-button
              v-for="day in weekdays"
              :key="day.value"
              size="small"
              :appearance="isWeekdaySelected(day.value) ? 'filled' : 'outline'"
              :color-role="isWeekdaySelected(day.value) ? 'primary' : 'secondary'"
              :aria-pressed="isWeekdaySelected(day.value) ? 'true' : 'false'"
              @click="toggleWeekday(day.value)"
            >
              {{ day.label }}
            </oc-button>
          </div>

          <!-- End condition -->
          <fieldset class="ext:m-0 ext:p-0 ext:border-0 ext:space-y-2">
            <legend class="ext:p-0 ext:mb-2 ext:font-medium">{{ $gettext('Ends') }}</legend>

            <div class="ext:flex ext:items-center ext:gap-2">
              <oc-radio
                id="end-never"
                v-model="recurrenceEndType"
                option="never"
                :label="$gettext('Never')"
              />
            </div>

            <div class="ext:flex ext:items-center ext:gap-2">
              <oc-radio
                id="end-count"
                v-model="recurrenceEndType"
                option="count"
                :label="$gettext('After')"
              />
              <oc-text-input
                id="event-repeat-count"
                class="ext:w-24"
                type="number"
                :label="$gettext('Number of occurrences')"
                :aria-label="$gettext('Number of occurrences')"
                :model-value="String(recurrenceCount)"
                min="1"
                max="999"
                :disabled="recurrenceEndType !== 'count'"
                @update:model-value="parseNumber($event, (n) => (recurrenceCount = n))"
              >
                <template #label><span /></template>
              </oc-text-input>
              <span>{{ $ngettext('occurrence', 'occurrences', recurrenceCount) }}</span>
            </div>

            <div class="ext:flex ext:items-center ext:gap-2">
              <oc-radio
                id="end-until"
                v-model="recurrenceEndType"
                option="until"
                :label="$gettext('On')"
              />
              <oc-text-input
                id="event-repeat-until"
                v-model="recurrenceUntil"
                type="date"
                :label="$gettext('End date')"
                :aria-label="$gettext('End date')"
                :disabled="recurrenceEndType !== 'until'"
              >
                <template #label><span /></template>
              </oc-text-input>
            </div>
          </fieldset>
        </div>
      </div>

      <!-- Location -->
      <div class="ext:relative">
        <div class="ext:relative">
          <oc-text-input
            id="event-location"
            v-model="formData.location"
            :label="$gettext('Location')"
            :placeholder="$gettext('Add location')"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="locationResults.length > 0 ? 'true' : 'false'"
            :aria-controls="locationListId"
            @update:model-value="handleLocationInput"
            @blur="handleLocationBlur"
          />
          <oc-spinner
            v-if="searchingLocation"
            size="small"
            class="ext:absolute ext:right-3 ext:bottom-2.5"
            :aria-label="$gettext('Searching locations')"
          />
        </div>

        <!-- Location Search Results -->
        <ul
          v-if="locationResults.length > 0"
          :id="locationListId"
          role="listbox"
          :aria-label="$gettext('Location suggestions')"
          class="ext:absolute ext:z-50 ext:w-full ext:mt-1 ext:p-1 ext:list-none ext:bg-role-surface ext:border ext:border-role-outline-variant ext:rounded ext:shadow-lg ext:max-h-60 ext:overflow-y-auto"
        >
          <li v-for="res in locationResults" :key="res.display_name" role="option">
            <oc-button
              class="ext:w-full ext:text-left ext:text-sm"
              appearance="raw"
              justify-content="left"
              @click="selectLocation(res.display_name)"
            >
              {{ res.display_name }}
            </oc-button>
          </li>
        </ul>
      </div>

      <!-- Description -->
      <oc-textarea
        id="event-description"
        v-model="formData.description"
        class="ext:w-full"
        :label="$gettext('Description')"
        :placeholder="$gettext('Add description')"
        rows="3"
      />

      <!-- Reminders -->
      <EventReminders
        :model-value="formData.alarms ?? []"
        :all-day="formData.allDay"
        :disabled="isReadOnly"
        @update:model-value="formData.alarms = $event"
      />

      <!-- Attendees -->
      <EventAttendees
        :attendees="formData.attendees ?? []"
        :organizer="formData.organizer"
        :disabled="isReadOnly"
        @update:attendees="formData.attendees = $event"
        @update:organizer="formData.organizer = $event"
        @download-invitation="handleDownloadInvitation"
      />

      <!-- Error -->
      <p v-if="error && !conflictData" class="ext:m-0 ext:text-sm ext:text-role-error" role="alert">
        {{ translateError(error, $gettext) }}
      </p>
    </form>

    <teleport defer :to="`#${modalActionsTarget(modal)}`">
      <oc-button
        v-if="isEditing"
        class="web-calendar-danger-button ext:ml-2"
        appearance="raw"
        :disabled="busy || isReadOnly"
        @click="handleDelete"
      >
        {{ editScope === 'single' ? $gettext('Delete this event') : $gettext('Delete') }}
      </oc-button>
      <oc-button
        v-if="isEditing"
        class="ext:ml-2"
        :aria-label="
          editScope === 'single'
            ? $gettext('Download this occurrence as .ics')
            : $gettext('Download as .ics')
        "
        :title="
          editScope === 'single'
            ? $gettext('Download this occurrence as .ics')
            : $gettext('Download as .ics')
        "
        @click="handleExport"
      >
        <oc-icon name="download-2" fill-type="line" size="small" />
        <span aria-hidden="true">.ics</span>
      </oc-button>
      <oc-button class="ext:ml-2" :disabled="busy" @click="emit('cancel')">
        {{ $gettext('Cancel') }}
      </oc-button>
      <oc-button
        class="ext:ml-2"
        appearance="filled"
        color-role="primary"
        submit="submit"
        :form="formId"
        :disabled="!canSave"
        :show-spinner="saving"
      >
        {{ saving ? $gettext('Saving...') : $gettext('Save') }}
      </oc-button>
    </teleport>
  </div>
</template>
