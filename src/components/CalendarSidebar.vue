<script setup lang="ts">
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import type { Calendar } from '../types/calendar'
import type { Share } from '../caldav/client'
import { canEditCalendar } from '../composables/useCalendarEditor'
import { SM_BREAKPOINT_QUERY, useMediaQuery } from '../composables/useMediaQuery'

const props = defineProps<{
  calendars: readonly Calendar[]
  pendingShares?: readonly Share[]
  userProfiles?: Record<string, string>
  loading: boolean
  isOpen: boolean
}>()

const emit = defineEmits<{
  toggle: [calendarHref: string]
  create: []
  edit: [calendarHref: string]
  delete: [calendarHref: string]
  share: [calendarHref: string]
  export: [calendarHref: string]
  copyUrl: [calendarHref: string]
  import: []
  acceptShare: [share: Share]
  declineShare: [share: Share]
  refresh: []
}>()

const { $gettext } = useGettext()

// Below the `sm` breakpoint the sidebar is an off-canvas drawer. While it is closed it is moved
// out of view, so it must also leave the tab order and the accessibility tree.
const isWideScreen = useMediaQuery(SM_BREAKPOINT_QUERY)
const isHidden = computed(() => !props.isOpen && !isWideScreen.value)

function calendarId(calendar: Calendar) {
  return calendar.href.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function checkboxId(calendar: Calendar) {
  return `web-calendar-visible-${calendarId(calendar)}`
}

function actionsToggleId(calendar: Calendar) {
  return `web-calendar-actions-${calendarId(calendar)}`
}

interface CalendarAction {
  name: string
  label: string
  icon: string
  title?: string
  handler: () => void
}

function calendarActions(calendar: Calendar): CalendarAction[] {
  const href = calendar.href
  const actions: CalendarAction[] = []
  if (canEditCalendar(calendar)) {
    actions.push({
      name: 'edit',
      label: $gettext('Edit calendar'),
      icon: 'pencil',
      handler: () => emit('edit', href)
    })
  }
  if (!calendar.readOnly && !calendar.isShared) {
    actions.push({
      name: 'share',
      label: $gettext('Share calendar'),
      icon: 'share',
      handler: () => emit('share', href)
    })
  }
  actions.push(
    {
      name: 'export',
      label: $gettext('Export as .ics'),
      icon: 'download-2',
      handler: () => emit('export', href)
    },
    {
      name: 'copy-url',
      label: $gettext('Copy subscription URL'),
      icon: 'links',
      title: $gettext(
        'CalDAV address for other calendar apps. They sign in with your user name and an app token.'
      ),
      handler: () => emit('copyUrl', href)
    },
    {
      name: 'delete',
      label: calendar.isShared ? $gettext('Leave calendar') : $gettext('Delete calendar'),
      icon: calendar.isShared ? 'logout-box-r' : 'delete-bin',
      handler: () => emit('delete', href)
    }
  )
  return actions
}
</script>

<template>
  <aside
    id="web-calendar-sidebar"
    :class="[
      'ext:w-56 ext:sm:w-64 ext:border-r ext:border-role-outline-variant ext:bg-role-surface-container ext:text-role-on-surface ext:overflow-y-auto ext:shrink-0',
      'ext:absolute ext:inset-y-0 ext:left-0 ext:z-20 ext:transition-transform ext:duration-200 ext:will-change-transform',
      'ext:sm:static ext:sm:z-auto ext:sm:transition-none ext:sm:shadow-none',
      isOpen ? 'ext:translate-x-0 ext:shadow-lg' : 'ext:-translate-x-full ext:sm:translate-x-0'
    ]"
    :aria-label="$gettext('Calendars')"
    :inert="isHidden"
  >
    <div class="ext:p-4">
      <!-- Pending Shares Section -->
      <section v-if="pendingShares && pendingShares.length > 0" class="ext:mb-6">
        <h3
          class="ext:m-0 ext:text-xs ext:font-semibold ext:text-role-on-surface-variant ext:uppercase ext:tracking-wider ext:mb-2"
        >
          {{ $gettext('Pending Invitations') }}
        </h3>
        <ul class="ext:list-none ext:m-0 ext:p-0 ext:space-y-2">
          <li
            v-for="share in pendingShares"
            :key="share.PathOrToken"
            class="ext:p-2 ext:bg-role-surface ext:border ext:border-role-outline-variant ext:rounded-md ext:shadow-sm"
          >
            <div class="ext:text-sm ext:font-medium ext:text-role-on-surface ext:truncate ext:mb-1">
              {{
                share.PathOrToken.split('/').filter(Boolean).pop()?.replace('-shared', '') ||
                $gettext('Calendar')
              }}
            </div>
            <div class="ext:text-xs ext:text-role-on-surface-variant ext:truncate ext:mb-2">
              {{ $gettext('From:') }} {{ userProfiles?.[share.Owner] || share.Owner }}
            </div>
            <div class="ext:flex ext:gap-2">
              <oc-button
                class="ext:flex-1"
                appearance="filled"
                color-role="primary"
                size="small"
                @click="emit('acceptShare', share)"
              >
                {{ $gettext('Accept') }}
              </oc-button>
              <oc-button class="ext:flex-1" size="small" @click="emit('declineShare', share)">
                {{ $gettext('Decline') }}
              </oc-button>
            </div>
          </li>
        </ul>
      </section>

      <div class="ext:flex ext:items-center ext:justify-between ext:mb-3">
        <h3
          class="ext:m-0 ext:text-sm ext:font-semibold ext:text-role-on-surface-variant ext:uppercase ext:tracking-wide"
        >
          {{ $gettext('Calendars') }}
        </h3>
        <div class="ext:flex ext:items-center ext:gap-1">
          <oc-button
            appearance="raw"
            color-role="primary"
            :aria-label="$gettext('Refresh')"
            :title="$gettext('Refresh')"
            :disabled="loading"
            @click="emit('refresh')"
          >
            <oc-spinner v-if="loading" size="small" />
            <oc-icon v-else name="refresh" fill-type="line" />
          </oc-button>
          <oc-button
            appearance="raw"
            color-role="primary"
            :aria-label="$gettext('Import calendar')"
            :title="$gettext('Import calendar')"
            @click="emit('import')"
          >
            <oc-icon name="upload-2" fill-type="line" />
          </oc-button>
          <oc-button
            appearance="raw"
            color-role="primary"
            :aria-label="$gettext('Create new calendar')"
            :title="$gettext('Create new calendar')"
            @click="emit('create')"
          >
            <oc-icon name="add" fill-type="line" />
          </oc-button>
        </div>
      </div>

      <div
        v-if="loading && calendars.length === 0"
        class="ext:text-sm ext:text-role-on-surface-variant"
      >
        {{ $gettext('Loading calendars...') }}
      </div>

      <div v-else-if="calendars.length === 0" class="ext:text-sm ext:text-role-on-surface-variant">
        {{ $gettext('No calendars found') }}
      </div>

      <ul v-else class="ext:list-none ext:m-0 ext:p-0 ext:space-y-2">
        <li
          v-for="calendar in calendars"
          :key="calendar.href"
          class="web-calendar-sidebar-item ext:group ext:flex ext:flex-col ext:gap-0.5"
        >
          <div class="ext:flex ext:items-center ext:gap-2">
            <!-- The checkbox takes the user's calendar color instead of the primary role -->
            <oc-checkbox
              :id="checkboxId(calendar)"
              :model-value="calendar.visible"
              :label="calendar.displayName"
              label-hidden
              :style="{ '--color-role-primary': calendar.color }"
              @update:model-value="emit('toggle', calendar.href)"
            />
            <label
              :for="checkboxId(calendar)"
              class="ext:flex ext:items-center ext:gap-2 ext:min-w-0 ext:text-sm ext:text-role-on-surface ext:cursor-pointer ext:flex-1"
            >
              <span
                class="ext:w-3 ext:h-3 ext:rounded-full ext:shrink-0"
                :style="{ backgroundColor: calendar.color }"
                aria-hidden="true"
              />
              <span class="ext:truncate">{{ calendar.displayName }}</span>
            </label>
            <oc-button
              :id="actionsToggleId(calendar)"
              class="ext:shrink-0"
              appearance="raw"
              size="small"
              :aria-label="$gettext('Actions for %{name}', { name: calendar.displayName })"
              :title="$gettext('Calendar actions')"
            >
              <oc-icon name="more-2" fill-type="line" size="small" />
            </oc-button>
            <oc-drop
              :drop-id="`${actionsToggleId(calendar)}-drop`"
              :toggle="`#${actionsToggleId(calendar)}`"
              :title="calendar.displayName"
              mode="click"
              position="bottom-end"
              padding-size="small"
              close-on-click
            >
              <oc-list>
                <li v-for="action in calendarActions(calendar)" :key="action.name">
                  <oc-button
                    :class="`web-calendar-action-${action.name}`"
                    class="ext:w-full ext:p-2"
                    appearance="raw"
                    justify-content="left"
                    :title="action.title"
                    @click="action.handler"
                  >
                    <oc-icon :name="action.icon" fill-type="line" size="small" />
                    <span>{{ action.label }}</span>
                  </oc-button>
                </li>
              </oc-list>
            </oc-drop>
          </div>
          <div
            v-if="calendar.isShared"
            class="ext:pl-9 ext:text-[10px] ext:text-role-on-surface-variant ext:truncate"
          >
            <span v-if="calendar.owner"
              >{{ $gettext('Shared by:') }}
              {{ userProfiles?.[calendar.owner] || calendar.owner }}</span
            >
            <span v-else>{{ $gettext('Shared via link') }}</span>
            <span v-if="calendar.readOnly"> ({{ $gettext('Read only') }})</span>
          </div>
          <div
            v-else-if="calendar.readOnly"
            class="ext:pl-9 ext:text-[10px] ext:text-role-on-surface-variant"
          >
            {{ $gettext('Read only') }}
          </div>
        </li>
      </ul>
    </div>
  </aside>
</template>
