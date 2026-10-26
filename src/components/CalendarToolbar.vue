<script setup lang="ts">
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { toLanguageTag } from '../utils/locale'

type ViewType = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'

const props = defineProps<{
  currentDate: Date
  viewType: ViewType
  sidebarOpen?: boolean
}>()

const emit = defineEmits<{
  prev: []
  next: []
  today: []
  'change-view': [view: ViewType]
  'toggle-sidebar': []
}>()

const language = useGettext()
const { $gettext } = language
const locale = computed(() => toLanguageTag(language.current))

const views = computed<{ value: ViewType; label: string }[]>(() => [
  { value: 'dayGridMonth', label: $gettext('Month') },
  { value: 'timeGridWeek', label: $gettext('Week') },
  { value: 'timeGridDay', label: $gettext('Day') }
])

const title = computed(() => {
  const date = props.currentDate
  if (props.viewType === 'timeGridDay') {
    return date.toLocaleDateString(locale.value, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }
  return date.toLocaleDateString(locale.value, {
    year: 'numeric',
    month: 'long'
  })
})
</script>

<template>
  <div
    class="ext:border-b ext:border-role-outline-variant ext:bg-role-surface ext:px-3 ext:sm:px-4 ext:py-2 ext:sm:py-3"
  >
    <!-- Controls row: nav buttons + (desktop) title on left, view switcher on right -->
    <div class="ext:flex ext:items-center ext:justify-between ext:gap-2">
      <div class="ext:flex ext:items-center ext:gap-1.5 ext:sm:gap-2 ext:min-w-0">
        <!-- Sidebar toggle: mobile only -->
        <oc-button
          class="ext:sm:hidden"
          appearance="raw"
          :aria-label="$gettext('Toggle sidebar')"
          :aria-expanded="sidebarOpen ? 'true' : 'false'"
          aria-controls="web-calendar-sidebar"
          @click="emit('toggle-sidebar')"
        >
          <oc-icon name="menu" fill-type="line" />
        </oc-button>

        <oc-button @click="emit('today')">
          {{ $gettext('Today') }}
        </oc-button>
        <oc-button appearance="raw" :aria-label="$gettext('Previous')" @click="emit('prev')">
          <oc-icon name="arrow-left-s" fill-type="line" />
        </oc-button>
        <oc-button appearance="raw" :aria-label="$gettext('Next')" @click="emit('next')">
          <oc-icon name="arrow-right-s" fill-type="line" />
        </oc-button>

        <!-- Title: only visible on sm+ in this row -->
        <h2
          class="ext:hidden ext:sm:block ext:m-0 ext:text-xl ext:font-semibold ext:text-role-on-surface ext:ml-2 ext:sm:ml-4 ext:truncate"
          aria-live="polite"
        >
          {{ title }}
        </h2>
      </div>

      <!-- View switcher -->
      <div class="oc-button-group ext:shrink-0" role="group" :aria-label="$gettext('View')">
        <oc-button
          v-for="view in views"
          :key="view.value"
          :appearance="viewType === view.value ? 'filled' : 'outline'"
          :aria-pressed="viewType === view.value ? 'true' : 'false'"
          @click="emit('change-view', view.value)"
        >
          {{ view.label }}
        </oc-button>
      </div>
    </div>

    <!-- Title row: mobile only (below controls) -->
    <h2
      class="ext:sm:hidden ext:m-0 ext:text-base ext:font-semibold ext:text-role-on-surface ext:mt-1.5 ext:truncate"
    >
      {{ title }}
    </h2>
  </div>
</template>
