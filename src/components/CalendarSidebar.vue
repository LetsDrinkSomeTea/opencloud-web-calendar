<script setup lang="ts">
import type { Calendar } from '../types/calendar'
import type { Share } from '../caldav/client'

defineProps<{
  calendars: readonly Calendar[]
  pendingShares?: readonly Share[]
  userProfiles?: Record<string, string>
  loading: boolean
  isOpen: boolean
}>()

const emit = defineEmits<{
  toggle: [calendarHref: string]
  create: []
  delete: [calendarHref: string]
  share: [calendarHref: string]
  import: []
  acceptShare: [share: Share]
  declineShare: [share: Share]
  refresh: []
}>()

function checkboxId(calendar: Calendar) {
  return `web-calendar-visible-${calendar.href.replace(/[^a-zA-Z0-9_-]/g, '_')}`
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
          class="ext:group ext:flex ext:flex-col ext:gap-0.5"
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
            <div class="ext:flex ext:items-center ext:gap-0.5">
              <oc-button
                v-if="!calendar.readOnly && !calendar.isShared"
                class="ext:shrink-0"
                appearance="raw"
                size="small"
                :aria-label="$gettext('Share calendar')"
                :title="$gettext('Share calendar')"
                @click.stop="emit('share', calendar.href)"
              >
                <oc-icon name="share" fill-type="line" size="small" />
              </oc-button>
              <oc-button
                class="ext:shrink-0"
                appearance="raw"
                size="small"
                :aria-label="
                  calendar.isShared ? $gettext('Leave calendar') : $gettext('Delete calendar')
                "
                :title="
                  calendar.isShared ? $gettext('Leave calendar') : $gettext('Delete calendar')
                "
                @click.stop="emit('delete', calendar.href)"
              >
                <oc-icon
                  :name="calendar.isShared ? 'logout-box-r' : 'delete-bin'"
                  fill-type="line"
                  size="small"
                />
              </oc-button>
            </div>
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
