<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { toLanguageTag } from '../utils/locale'
import { AGENDA_DAYS } from '../utils/new-event'
import type { CalendarViewType } from '../config'

/** Delay before a typed search query is applied */
const SEARCH_DEBOUNCE_MS = 300

const props = withDefaults(
  defineProps<{
    currentDate: Date
    viewType: CalendarViewType
    sidebarOpen?: boolean
    /** Active search query */
    searchQuery?: string
    /** A writable calendar exists, so events can be created */
    canCreate?: boolean
  }>(),
  { sidebarOpen: false, searchQuery: '', canCreate: true }
)

const emit = defineEmits<{
  prev: []
  next: []
  today: []
  'change-view': [view: CalendarViewType]
  'toggle-sidebar': []
  'new-event': []
  search: [query: string]
}>()

const language = useGettext()
const { $gettext } = language
const locale = computed(() => toLanguageTag(language.current))

const views = computed<{ value: CalendarViewType; label: string }[]>(() => [
  { value: 'dayGridMonth', label: $gettext('Month') },
  { value: 'timeGridWeek', label: $gettext('Week') },
  { value: 'timeGridDay', label: $gettext('Day') },
  { value: 'listAgenda', label: $gettext('Agenda') }
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
  if (props.viewType === 'listAgenda') {
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + AGENDA_DAYS - 1)
    return new Intl.DateTimeFormat(locale.value, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).formatRange(date, end)
  }
  return date.toLocaleDateString(locale.value, {
    year: 'numeric',
    month: 'long'
  })
})

// Search: the input is applied after a short pause or immediately on Enter
const searchInput = ref(props.searchQuery)
const searchExpanded = ref(props.searchQuery !== '')
const searchContainer = ref<HTMLElement | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | undefined

function cancelPendingSearch() {
  if (searchTimer !== undefined) {
    clearTimeout(searchTimer)
    searchTimer = undefined
  }
}

function applySearch(value = searchInput.value) {
  cancelPendingSearch()
  const query = value.trim()
  if (query !== props.searchQuery) emit('search', query)
}

watch(searchInput, (value) => {
  cancelPendingSearch()
  searchTimer = setTimeout(() => applySearch(value), SEARCH_DEBOUNCE_MS)
})

// Changes from outside (route, cleared search)
watch(
  () => props.searchQuery,
  (query) => {
    if (query !== searchInput.value.trim()) {
      searchInput.value = query
      cancelPendingSearch()
    }
    if (query) searchExpanded.value = true
  }
)

onBeforeUnmount(cancelPendingSearch)

/** Mobile only: shows the search field or hides and clears it */
async function toggleSearch() {
  if (searchExpanded.value) {
    searchExpanded.value = false
    searchInput.value = ''
    applySearch('')
    return
  }
  searchExpanded.value = true
  await nextTick()
  searchContainer.value?.querySelector('input')?.focus()
}
</script>

<template>
  <div
    class="ext:border-b ext:border-role-outline-variant ext:bg-role-surface ext:px-3 ext:sm:px-4 ext:py-2 ext:sm:py-3"
  >
    <div class="ext:flex ext:flex-wrap ext:items-center ext:gap-x-2 ext:gap-y-1.5">
      <!-- Navigation and (sm+) title -->
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

        <h2
          class="ext:hidden ext:sm:block ext:m-0 ext:text-xl ext:font-semibold ext:text-role-on-surface ext:ml-2 ext:sm:ml-4 ext:truncate"
          aria-live="polite"
        >
          {{ title }}
        </h2>
      </div>

      <!-- Search: inline on sm+, an own row on mobile when expanded -->
      <div
        ref="searchContainer"
        class="ext:hidden ext:sm:block ext:sm:ml-auto ext:w-56 ext:lg:w-64"
        :class="{
          'ext:max-sm:block ext:max-sm:order-last ext:max-sm:basis-full ext:max-sm:w-full':
            searchExpanded
        }"
      >
        <oc-search-bar
          v-model="searchInput"
          small
          button-hidden
          is-filter
          :label="$gettext('Search events')"
          :placeholder="$gettext('Search events')"
          @search="applySearch()"
          @advanced-search="applySearch()"
        />
      </div>

      <!-- New event (and the search toggle on mobile) -->
      <div class="ext:flex ext:items-center ext:gap-1.5 ext:sm:gap-2 ext:ml-auto ext:sm:ml-0">
        <!-- Search toggle: mobile only -->
        <oc-button
          class="ext:sm:hidden"
          appearance="raw"
          :aria-label="searchExpanded ? $gettext('Close search') : $gettext('Search events')"
          :aria-expanded="searchExpanded ? 'true' : 'false'"
          @click="toggleSearch"
        >
          <oc-icon :name="searchExpanded ? 'close' : 'search'" fill-type="line" />
        </oc-button>

        <oc-button
          appearance="filled"
          :aria-label="$gettext('New event')"
          :disabled="!canCreate"
          data-testid="web-calendar-new-event"
          @click="emit('new-event')"
        >
          <oc-icon name="add" fill-type="line" />
          <span class="ext:hidden ext:sm:inline">{{ $gettext('New event') }}</span>
        </oc-button>
      </div>

      <!-- Title: mobile only -->
      <h2
        class="ext:sm:hidden ext:flex-1 ext:min-w-0 ext:m-0 ext:text-base ext:font-semibold ext:text-role-on-surface ext:truncate"
      >
        {{ title }}
      </h2>

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
  </div>
</template>
