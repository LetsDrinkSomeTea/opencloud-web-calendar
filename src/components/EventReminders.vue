<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useGettext } from 'vue3-gettext'
import type { EventAlarm } from '../types/calendar'
import { isSameRelativeAlarm } from '../caldav/alarms'
import {
  ALARM_UNIT_SECONDS,
  ALL_DAY_ALARM_PRESETS,
  TIMED_ALARM_PRESETS,
  describeAlarm,
  type AlarmUnit
} from '../utils/alarm-label'
import { toLanguageTag } from '../utils/locale'
import { useNotificationPermission } from '../composables/useReminders'

/** Reminders (`VALARM`) of the event form */
const props = defineProps<{
  modelValue: EventAlarm[]
  allDay: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [alarms: EventAlarm[]]
}>()

const gettext = useGettext()
const { $gettext, $ngettext } = gettext
const { notificationPermission, requestPermission } = useNotificationPermission()

const CUSTOM = 'custom'
const idPrefix = `web-calendar-reminder-${useId()}`

const showCustom = ref(false)
const customAmount = ref(15)
const customUnit = ref<AlarmUnit>('minutes')

function formatDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat(toLanguageTag(gettext.current), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

function label(alarm: EventAlarm): string {
  return describeAlarm(alarm, props.allDay, { $gettext, $ngettext }, formatDate)
}

const presetOptions = computed(() => {
  const presets = props.allDay ? ALL_DAY_ALARM_PRESETS : TIMED_ALARM_PRESETS
  return [
    ...presets.map((offset) => ({
      value: String(offset),
      label: label({ action: 'DISPLAY', offset, related: 'START' })
    })),
    { value: CUSTOM, label: $gettext('Custom…') }
  ]
})

const unitOptions = computed<{ value: AlarmUnit; label: string }[]>(() => [
  { value: 'minutes', label: $ngettext('minute', 'minutes', customAmount.value) },
  { value: 'hours', label: $ngettext('hour', 'hours', customAmount.value) },
  { value: 'days', label: $ngettext('day', 'days', customAmount.value) },
  { value: 'weeks', label: $ngettext('week', 'weeks', customAmount.value) }
])

function addAlarm(offset: number) {
  const alarm: EventAlarm = { action: 'DISPLAY', offset, related: 'START' }
  if (props.modelValue.some((a) => isSameRelativeAlarm(a, alarm))) return
  emit('update:modelValue', [...props.modelValue, alarm])
}

// The select only triggers an action, it never keeps a value
const selectedPreset = ref<string | null>(null)

function handlePreset(value: string | null) {
  selectedPreset.value = null
  if (!value) return
  if (value === CUSTOM) {
    showCustom.value = true
    return
  }
  addAlarm(Number(value))
}

function addCustom() {
  if (!Number.isFinite(customAmount.value) || customAmount.value < 0) return
  addAlarm(-customAmount.value * ALARM_UNIT_SECONDS[customUnit.value])
  showCustom.value = false
}

function parseAmount(value: string) {
  const n = parseInt(value, 10)
  if (!Number.isNaN(n)) customAmount.value = n
}

function removeAlarm(index: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index)
  )
}
</script>

<template>
  <fieldset class="web-calendar-event-reminders ext:m-0 ext:p-0 ext:border-0 ext:space-y-2">
    <legend class="ext:p-0 ext:mb-2 ext:font-medium">{{ $gettext('Reminders') }}</legend>

    <ul v-if="modelValue.length > 0" class="ext:m-0 ext:p-0 ext:list-none ext:space-y-1">
      <li
        v-for="(alarm, index) in modelValue"
        :key="index"
        class="ext:flex ext:items-center ext:justify-between ext:gap-2 ext:text-sm"
      >
        <span class="ext:flex ext:items-center ext:gap-2">
          <oc-icon name="notification-3" fill-type="line" size="small" />
          <span>{{ label(alarm) }}</span>
        </span>
        <oc-button
          appearance="raw"
          size="small"
          :disabled="disabled"
          :aria-label="$gettext('Remove reminder %{label}', { label: label(alarm) })"
          :title="$gettext('Remove reminder')"
          @click="removeAlarm(index)"
        >
          <oc-icon name="close" size="small" />
        </oc-button>
      </li>
    </ul>

    <oc-select
      v-if="!disabled"
      :id="`${idPrefix}-preset`"
      :model-value="selectedPreset"
      :label="$gettext('Add reminder')"
      label-hidden
      :placeholder="$gettext('Add reminder')"
      :options="presetOptions"
      :reduce="(option: { value: string }) => option.value"
      :searchable="false"
      :clearable="false"
      position-fixed
      @update:model-value="handlePreset"
    />

    <div v-if="showCustom && !disabled" class="ext:flex ext:flex-wrap ext:items-end ext:gap-2">
      <oc-text-input
        :id="`${idPrefix}-amount`"
        class="ext:w-24"
        type="number"
        min="0"
        max="999"
        :label="$gettext('Amount')"
        :model-value="String(customAmount)"
        @update:model-value="parseAmount"
      />
      <oc-select
        :id="`${idPrefix}-unit`"
        v-model="customUnit"
        class="ext:w-36"
        :label="$gettext('Unit')"
        :options="unitOptions"
        :reduce="(option: { value: string }) => option.value"
        :searchable="false"
        :clearable="false"
        position-fixed
      />
      <span class="ext:pb-2">{{ $gettext('before') }}</span>
      <oc-button size="small" @click="addCustom">{{ $gettext('Add') }}</oc-button>
    </div>

    <p
      v-if="modelValue.length > 0 && notificationPermission === 'default'"
      class="ext:m-0 ext:text-sm ext:text-role-on-surface-variant ext:flex ext:flex-wrap ext:items-center ext:gap-2"
    >
      <span>{{ $gettext('Reminders are shown while the calendar is open.') }}</span>
      <oc-button appearance="raw" size="small" @click="requestPermission">
        {{ $gettext('Enable browser notifications') }}
      </oc-button>
    </p>
    <p
      v-else-if="modelValue.length > 0"
      class="ext:m-0 ext:text-sm ext:text-role-on-surface-variant"
    >
      {{ $gettext('Reminders are shown while the calendar is open.') }}
    </p>
  </fieldset>
</template>
