<script setup lang="ts">
import type { Modal } from '@opencloud-eu/web-pkg'

export interface InviteData {
  token?: string
  calendarPath?: string
  displayName: string
  color: string
  permissions: string
  owner?: string
}

/** Content of the "Join Shared Calendar" modal; joining is done by the modal's confirm button */
defineProps<{
  modal: Modal
  inviteData: InviteData
}>()
</script>

<template>
  <div class="ext:space-y-4 ext:text-role-on-surface">
    <p class="ext:m-0 ext:text-sm ext:text-role-on-surface-variant">
      {{
        $gettext('You have been invited to join the calendar "%{name}".', {
          name: inviteData.displayName
        })
      }}
    </p>

    <!-- Calendar Preview Card -->
    <div
      class="ext:p-4 ext:bg-role-surface-container ext:rounded-lg ext:border ext:border-role-outline-variant ext:flex ext:items-center ext:justify-between ext:gap-3"
    >
      <div class="ext:flex ext:items-center ext:gap-3 ext:min-w-0">
        <!-- The calendar's own color -->
        <span
          class="ext:w-4 ext:h-4 ext:rounded-full ext:shrink-0"
          :style="{ backgroundColor: inviteData.color || '#3788d8' }"
          aria-hidden="true"
        />
        <div class="ext:min-w-0">
          <div class="ext:text-sm ext:font-medium ext:truncate">
            {{ inviteData.displayName }}
          </div>
          <div v-if="inviteData.owner" class="ext:text-xs ext:text-role-on-surface-variant">
            {{ $gettext('Shared by:') }} {{ inviteData.owner }}
          </div>
        </div>
      </div>
      <span
        :class="[
          'ext:shrink-0 ext:px-2.5 ext:py-0.5 ext:text-xs ext:font-medium ext:rounded-full',
          inviteData.permissions === 'rw'
            ? 'ext:bg-role-primary-container ext:text-role-on-primary-container'
            : 'ext:bg-role-surface-container-highest ext:text-role-on-surface-variant'
        ]"
      >
        {{ inviteData.permissions === 'rw' ? $gettext('Read & Write') : $gettext('Read only') }}
      </span>
    </div>
  </div>
</template>
