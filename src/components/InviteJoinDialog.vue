<script setup lang="ts">
import { t } from '../composables/useLanguage'

export interface InviteData {
  token?: string
  calendarPath?: string
  displayName: string
  color: string
  permissions: string
  owner?: string
}

defineProps<{
  isOpen: boolean
  inviteData: InviteData | null
  loading?: boolean
}>()

const emit = defineEmits<{
  join: []
  close: []
}>()
</script>

<template>
  <div
    v-if="isOpen && inviteData"
    class="ext:fixed ext:inset-0 ext:z-50 ext:flex ext:items-center ext:justify-center ext:p-4 ext:bg-black/50"
    @click.self="emit('close')"
  >
    <div class="ext:bg-white ext:rounded-lg ext:shadow-xl ext:w-full ext:max-w-md ext:overflow-hidden">
      <!-- Header -->
      <div class="ext:p-6 ext:border-b ext:border-gray-200 ext:flex ext:items-center ext:justify-between">
        <div class="ext:flex ext:items-center ext:gap-2.5">
          <div class="ext:w-8 ext:h-8 ext:rounded-full ext:bg-blue-100 ext:text-blue-600 ext:flex ext:items-center ext:justify-center">
            <svg class="ext:w-4 ext:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 class="ext:text-lg ext:font-semibold ext:text-gray-900">
            {{ t('Join Shared Calendar') }}
          </h2>
        </div>
        <button
          type="button"
          class="ext:text-gray-400 hover:ext:text-gray-500"
          @click="emit('close')"
        >
          <svg class="ext:w-5 ext:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="ext:p-6 ext:space-y-4">
        <p class="ext:text-sm ext:text-gray-600">
          {{ t('You have been invited to join the calendar "%{name}".', { name: inviteData.displayName }) }}
        </p>

        <!-- Calendar Preview Card -->
        <div class="ext:p-4 ext:bg-gray-50 ext:rounded-lg ext:border ext:border-gray-200 ext:flex ext:items-center ext:justify-between">
          <div class="ext:flex ext:items-center ext:gap-3">
            <span
              class="ext:w-4 ext:h-4 ext:rounded-full ext:shrink-0"
              :style="{ backgroundColor: inviteData.color || '#3788d8' }"
            />
            <div>
              <div class="ext:text-sm ext:font-medium ext:text-gray-900">
                {{ inviteData.displayName }}
              </div>
              <div v-if="inviteData.owner" class="ext:text-xs ext:text-gray-500">
                {{ t('Shared by:') }} {{ inviteData.owner }}
              </div>
            </div>
          </div>
          <span
            :class="[
              'ext:px-2.5 ext:py-0.5 ext:text-xs ext:font-medium ext:rounded-full',
              inviteData.permissions === 'rw'
                ? 'ext:bg-blue-100 ext:text-blue-800'
                : 'ext:bg-gray-200 ext:text-gray-700'
            ]"
          >
            {{ inviteData.permissions === 'rw' ? t('Read & Write') : t('Read only') }}
          </span>
        </div>
      </div>

      <!-- Footer Actions -->
      <div class="ext:p-4 ext:bg-gray-50 ext:border-t ext:border-gray-200 ext:flex ext:justify-end ext:gap-2">
        <button
          type="button"
          class="ext:px-4 ext:py-2 ext:bg-white ext:border ext:border-gray-300 ext:text-gray-700 ext:text-sm ext:font-medium ext:rounded-md hover:ext:bg-gray-50"
          :disabled="loading"
          @click="emit('close')"
        >
          {{ t('Cancel') }}
        </button>
        <button
          type="button"
          class="ext:px-4 ext:py-2 ext:bg-blue-600 ext:text-white ext:text-sm ext:font-medium ext:rounded-md hover:ext:bg-blue-700 disabled:ext:opacity-50"
          :disabled="loading"
          @click="emit('join')"
        >
          {{ loading ? t('Saving...') : t('Join Calendar') }}
        </button>
      </div>
    </div>
  </div>
</template>
