<script setup lang="ts">
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { toLanguageTag } from '../utils/locale'
import { dateToQuery } from '../utils/route-query'
import type { Calendar, CalendarEvent, DateRange } from '../types/calendar'

const props = defineProps<{
  query: string
  results: CalendarEvent[]
  calendars: readonly Calendar[]
  range: DateRange | null
  loading?: boolean
  serverFailed?: boolean
  serverSearchEnabled?: boolean
}>()

const emit = defineEmits<{
  'event-click': [event: CalendarEvent]
}>()

const language = useGettext()
const { $gettext, $ngettext } = language
const locale = computed(() => toLanguageTag(language.current))

const colors = computed(() => {
  const map = new Map<string, string>()
  for (const calendar of props.calendars)
    map.set(calendar.href.replace(/\/?$/, '/'), calendar.color)
  return map
})

function colorOf(event: CalendarEvent): string {
  return colors.value.get(event.calendarHref.replace(/\/?$/, '/')) || '#3788d8'
}

function formatDay(date: Date): string {
  return date.toLocaleDateString(locale.value, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
}

function timeLabel(event: CalendarEvent): string {
  if (event.allDay) return $gettext('All day')
  return `${formatTime(event.start)} – ${formatTime(event.end)}`
}

const groups = computed(() => {
  const result: { key: string; label: string; events: CalendarEvent[] }[] = []
  for (const event of props.results) {
    const key = dateToQuery(event.start)
    let group = result[result.length - 1]
    if (!group || group.key !== key) {
      group = { key, label: formatDay(event.start), events: [] }
      result.push(group)
    }
    group.events.push(event)
  }
  return result
})

const rangeText = computed(() => {
  if (!props.range) return ''
  // The range end is exclusive
  const end = new Date(props.range.end.getTime() - 1)
  const values = { start: formatShortDate(props.range.start), end: formatShortDate(end) }
  if (props.serverSearchEnabled && !props.serverFailed) {
    return $gettext('Searching events from %{start} to %{end}.', values)
  }
  return $gettext('Only the loaded events from %{start} to %{end} are searched.', values)
})

const statusText = computed(() => {
  if (props.loading && props.results.length === 0) return $gettext('Searching…')
  if (props.results.length === 0) {
    return $gettext('No events found for “%{query}”.', { query: props.query })
  }
  return $ngettext('%{count} event found', '%{count} events found', props.results.length, {
    count: String(props.results.length)
  })
})
</script>

<template>
  <section
    class="web-calendar-search-results ext:flex-1 ext:overflow-auto ext:bg-role-surface ext:px-3 ext:sm:px-4 ext:py-3"
    :aria-label="$gettext('Search results')"
    :aria-busy="loading ? 'true' : 'false'"
  >
    <div class="ext:mb-3">
      <p class="ext:m-0 ext:font-semibold ext:text-role-on-surface" role="status">
        {{ statusText }}
        <oc-spinner
          v-if="loading && results.length > 0"
          size="small"
          class="ext:ml-2 ext:align-middle"
          :aria-label="$gettext('Searching…')"
        />
      </p>
      <p v-if="rangeText" class="ext:m-0 ext:mt-1 ext:text-sm ext:text-role-on-surface-variant">
        {{ rangeText }}
        <template v-if="serverFailed">
          {{ $gettext('The server search failed.') }}
        </template>
      </p>
    </div>

    <div v-for="group in groups" :key="group.key" class="ext:mb-3">
      <h3
        class="ext:m-0 ext:px-2 ext:py-1 ext:text-sm ext:font-semibold ext:bg-role-surface-container ext:text-role-on-surface ext:rounded"
      >
        {{ group.label }}
      </h3>
      <ul class="ext:list-none ext:m-0 ext:p-0">
        <li
          v-for="event in group.events"
          :key="`${event.calendarHref}${event.uid}${event.recurrenceId ?? ''}`"
        >
          <button
            type="button"
            class="ext:flex ext:w-full ext:items-start ext:gap-3 ext:px-2 ext:py-2 ext:text-left ext:bg-transparent ext:border-0 ext:border-b ext:border-solid ext:border-role-outline-variant ext:text-role-on-surface ext:cursor-pointer ext:hover:bg-role-surface-container ext:focus-visible:outline-2 ext:focus-visible:outline-role-primary"
            @click="emit('event-click', event)"
          >
            <span
              class="ext:mt-1.5 ext:size-2.5 ext:shrink-0 ext:rounded-full"
              :style="{ backgroundColor: colorOf(event) }"
              aria-hidden="true"
            />
            <span
              class="ext:w-28 ext:shrink-0 ext:text-sm ext:text-role-on-surface-variant ext:tabular-nums"
            >
              {{ timeLabel(event) }}
            </span>
            <span class="ext:min-w-0 ext:flex-1">
              <span class="ext:block ext:font-medium ext:truncate">
                {{ event.summary || $gettext('(No title)') }}
              </span>
              <span
                v-if="event.location"
                class="ext:block ext:text-sm ext:text-role-on-surface-variant ext:truncate"
              >
                {{ event.location }}
              </span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
