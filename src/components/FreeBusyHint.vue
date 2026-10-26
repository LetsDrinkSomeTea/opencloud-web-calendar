<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useFreeBusy } from '../composables/useFreeBusy'
import type { Calendar } from '../types/calendar'

/**
 * Non-intrusive hint in the event editor when the chosen time overlaps busy time in the user's
 * visible calendars (own and shared ones). Shown for timed events only.
 */
const props = defineProps<{
  calendars: readonly Calendar[]
  start: Date
  end: Date
  allDay: boolean
  /** Event being edited, its own busy period is ignored */
  ignore?: { start?: Date; end?: Date } | null
}>()

/** Delay before querying, so typing a time doesn't send a request per keystroke */
const DEBOUNCE_MS = 400

const { $ngettext } = useGettext()
const { conflicts, check, clear } = useFreeBusy()

const calendarHrefs = computed(() => props.calendars.filter((c) => c.visible).map((c) => c.href))

const ignoreRange = computed(() => {
  const { start, end } = props.ignore ?? {}
  return start instanceof Date && end instanceof Date ? { start, end } : null
})

const message = computed(() => {
  const count = conflicts.value.length
  return $ngettext(
    'This time overlaps with %{count} busy period in your calendars.',
    'This time overlaps with %{count} busy periods in your calendars.',
    count,
    { count: String(count) }
  )
})

let timer: ReturnType<typeof setTimeout> | null = null

function cancelTimer() {
  if (timer) clearTimeout(timer)
  timer = null
}

watch(
  () =>
    [
      props.start.getTime(),
      props.end.getTime(),
      props.allDay,
      calendarHrefs.value.join(','),
      ignoreRange.value?.start.getTime(),
      ignoreRange.value?.end.getTime()
    ] as const,
  () => {
    cancelTimer()
    if (props.allDay || isNaN(props.start.getTime()) || isNaN(props.end.getTime())) {
      clear()
      return
    }
    timer = setTimeout(() => {
      timer = null
      check({
        calendarHrefs: calendarHrefs.value,
        start: props.start,
        end: props.end,
        ignore: ignoreRange.value
      })
    }, DEBOUNCE_MS)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  cancelTimer()
  clear()
})
</script>

<template>
  <p
    v-if="!allDay && conflicts.length > 0"
    class="web-calendar-free-busy-hint ext:flex ext:items-center ext:gap-1 ext:text-sm ext:text-role-on-surface-variant ext:m-0 ext:mb-2"
    role="status"
  >
    <oc-icon name="time" fill-type="line" size="small" class="ext:shrink-0" />
    <span>{{ message }}</span>
  </p>
</template>
