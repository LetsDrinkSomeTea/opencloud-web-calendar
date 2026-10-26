<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { t } from '../composables/useLanguage'
import { useSharing } from '../composables/useSharing'
import type { Calendar } from '../types/calendar'

const props = defineProps<{
  calendar: Calendar
  isOpen: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const {
  userShares,
  tokenShares,
  userProfiles,
  loading,
  error,
  fetchShares,
  shareWithUser,
  createPublicLink,
  removeShare,
  updatePermissions
} = useSharing(props.calendar.href)

const newUserEmail = ref('')
const newSharePermission = ref('r')
const newLinkPermission = ref('r')
const copiedKey = ref<string | null>(null)

onMounted(() => {
  if (props.isOpen) {
    fetchShares()
  }
})

async function handleShareWithUser() {
  if (!newUserEmail.value) return
  try {
    await shareWithUser(newUserEmail.value, newSharePermission.value)
    newUserEmail.value = ''
  } catch {
    // Error is handled in composable
  }
}

async function handleCreatePublicLink() {
  try {
    await createPublicLink(newLinkPermission.value)
  } catch {
    // Error is handled in composable
  }
}

function copyToClipboard(text: string, key?: string) {
  navigator.clipboard.writeText(text)
  if (key) {
    copiedKey.value = key
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null
    }, 2000)
  }
}

function getWebInviteUrl(token: string, perm: string) {
  const origin = window.location.origin
  const pathname = window.location.pathname
  const tokenParam = encodeURIComponent(token)
  const pathParam = encodeURIComponent(props.calendar.href)
  const nameParam = encodeURIComponent(props.calendar.displayName)
  const colorParam = encodeURIComponent(props.calendar.color || '#3788d8')
  return `${origin}${pathname}#/?join_token=${tokenParam}&path=${pathParam}&name=${nameParam}&color=${colorParam}&perm=${perm}`
}

function getCalDAVUrl(token: string) {
  const origin = window.location.origin
  const caldavPath = token.startsWith('/caldav/')
    ? token
    : `/caldav${token.startsWith('/') ? '' : '/'}${token}`
  return `${origin}${caldavPath}`
}
</script>

<template>
  <div
    v-if="isOpen"
    class="ext:fixed ext:inset-0 ext:z-50 ext:flex ext:items-center ext:justify-center ext:p-4 ext:bg-black/50"
    @click.self="emit('close')"
  >
    <div
      class="ext:bg-white ext:rounded-lg ext:shadow-xl ext:w-full ext:max-w-2xl ext:max-h-[90vh] ext:flex ext:flex-col"
    >
      <div
        class="ext:p-6 ext:border-b ext:border-gray-200 ext:flex ext:items-center ext:justify-between"
      >
        <h2 class="ext:text-xl ext:font-semibold ext:text-gray-900">
          {{ t('Share calendar: %{name}', { name: calendar.displayName }) }}
        </h2>
        <button
          type="button"
          class="ext:text-gray-400 hover:ext:text-gray-500"
          @click="emit('close')"
        >
          <svg class="ext:w-6 ext:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div class="ext:p-6 ext:overflow-y-auto ext:flex-1">
        <div
          v-if="error"
          class="ext:mb-4 ext:p-3 ext:bg-red-50 ext:text-red-700 ext:text-sm ext:rounded-md"
        >
          {{ error }}
        </div>

        <!-- Section: Share with users -->
        <section class="ext:mb-8">
          <h3 class="ext:text-sm ext:font-medium ext:text-gray-700 ext:mb-3">
            {{ t('Share with users') }}
          </h3>
          <div class="ext:flex ext:gap-2 ext:mb-4">
            <input
              v-model="newUserEmail"
              type="text"
              :placeholder="t('User ID or Email')"
              class="ext:flex-1 ext:rounded-md ext:border-gray-300 ext:text-sm focus:ext:border-blue-500 focus:ext:ring-blue-500"
              @keyup.enter="handleShareWithUser"
            />
            <select
              v-model="newSharePermission"
              class="ext:rounded-md ext:border-gray-300 ext:text-sm focus:ext:border-blue-500 focus:ext:ring-blue-500"
            >
              <option value="r">{{ t('Read') }}</option>
              <option value="rw">{{ t('Read & Write') }}</option>
            </select>
            <button
              type="button"
              class="ext:px-4 ext:py-2 ext:bg-blue-600 ext:text-white ext:text-sm ext:font-medium ext:rounded-md hover:ext:bg-blue-700 disabled:ext:opacity-50"
              :disabled="loading || !newUserEmail"
              @click="handleShareWithUser"
            >
              {{ t('Invite') }}
            </button>
          </div>

          <ul v-if="userShares.length > 0" class="ext:space-y-3">
            <li
              v-for="share in userShares"
              :key="share.PathOrToken"
              class="ext:flex ext:items-center ext:justify-between ext:p-3 ext:bg-gray-50 ext:rounded-lg"
            >
              <div class="ext:flex ext:items-center ext:gap-3">
                <div
                  class="ext:w-8 ext:h-8 ext:bg-blue-100 ext:text-blue-600 ext:rounded-full ext:flex ext:items-center ext:justify-center ext:text-xs ext:font-bold"
                >
                  {{ (userProfiles[share.User] || share.User).slice(0, 2).toUpperCase() }}
                </div>
                <div>
                  <div class="ext:flex ext:items-center ext:gap-2">
                    <span class="ext:text-sm ext:font-medium ext:text-gray-900">{{
                      userProfiles[share.User] || share.User
                    }}</span>
                    <!-- Status Badges -->
                    <span
                      v-if="share.EnabledByUser"
                      class="ext:px-1.5 ext:py-0.5 ext:text-[10px] ext:font-medium ext:bg-green-100 ext:text-green-700 ext:rounded"
                    >
                      {{ t('Accepted') }}
                    </span>
                    <span
                      v-else-if="!share.EnabledByUser && share.HiddenByUser"
                      class="ext:px-1.5 ext:py-0.5 ext:text-[10px] ext:font-medium ext:bg-yellow-100 ext:text-yellow-700 ext:rounded"
                    >
                      {{ t('Invited') }}
                    </span>
                    <span
                      v-else
                      class="ext:px-1.5 ext:py-0.5 ext:text-[10px] ext:font-medium ext:bg-red-100 ext:text-red-700 ext:rounded"
                    >
                      {{ t('Left') }}
                    </span>
                  </div>
                  <div class="ext:text-xs ext:text-gray-500">
                    {{ share.Permissions === 'r' ? t('Read only') : t('Read & Write') }}
                  </div>
                </div>
              </div>
              <div class="ext:flex ext:items-center ext:gap-2">
                <select
                  :value="share.Permissions"
                  class="ext:text-xs ext:rounded ext:border-gray-300 ext:bg-transparent"
                  @change="updatePermissions(share, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="r">{{ t('Read') }}</option>
                  <option value="rw">{{ t('Read & Write') }}</option>
                </select>
                <button
                  type="button"
                  class="ext:p-1 ext:text-gray-400 hover:ext:text-red-600"
                  :title="t('Remove share')"
                  @click="removeShare(share)"
                >
                  <svg
                    class="ext:w-4 ext:h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </li>
          </ul>
        </section>

        <!-- Section: Invite & Public Links -->
        <section>
          <h3 class="ext:text-sm ext:font-medium ext:text-gray-700 ext:mb-3">
            {{ t('Invite & Public links') }}
          </h3>
          <div class="ext:flex ext:gap-2 ext:mb-4">
            <select
              v-model="newLinkPermission"
              class="ext:rounded-md ext:border-gray-300 ext:text-sm focus:ext:border-blue-500 focus:ext:ring-blue-500"
            >
              <option value="r">{{ t('Read') }}</option>
              <option value="rw">{{ t('Read & Write') }}</option>
            </select>
            <button
              type="button"
              class="ext:px-4 ext:py-2 ext:bg-blue-600 ext:text-white ext:text-sm ext:font-medium ext:rounded-md hover:ext:bg-blue-700 disabled:ext:opacity-50"
              :disabled="loading"
              @click="handleCreatePublicLink"
            >
              {{ t('Create invite link') }}
            </button>
          </div>

          <ul v-if="tokenShares.length > 0" class="ext:space-y-4">
            <li
              v-for="share in tokenShares"
              :key="share.PathOrToken"
              class="ext:p-4 ext:bg-gray-50 ext:rounded-lg ext:border ext:border-gray-200"
            >
              <!-- Link Header: Permissions & Actions -->
              <div class="ext:flex ext:items-center ext:justify-between ext:mb-3">
                <div class="ext:flex ext:items-center ext:gap-2">
                  <span
                    :class="[
                      'ext:px-2 ext:py-0.5 ext:text-xs ext:font-medium ext:rounded-full',
                      share.Permissions === 'rw'
                        ? 'ext:bg-blue-100 ext:text-blue-800'
                        : 'ext:bg-gray-200 ext:text-gray-700'
                    ]"
                  >
                    {{ share.Permissions === 'rw' ? t('Read & Write') : t('Read only') }}
                  </span>
                  <select
                    :value="share.Permissions"
                    class="ext:text-xs ext:rounded ext:border-gray-300 ext:bg-white ext:py-0.5 ext:px-1.5"
                    @change="updatePermissions(share, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="r">{{ t('Read') }}</option>
                    <option value="rw">{{ t('Read & Write') }}</option>
                  </select>
                </div>
                <button
                  type="button"
                  class="ext:p-1 ext:text-gray-400 hover:ext:text-red-600"
                  :title="t('Revoke link')"
                  @click="removeShare(share)"
                >
                  <svg
                    class="ext:w-4 ext:h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>

              <!-- Web Invite Link -->
              <div class="ext:mb-2.5">
                <div
                  class="ext:text-xs ext:font-medium ext:text-gray-600 ext:mb-1 ext:flex ext:items-center ext:gap-1.5"
                >
                  <svg
                    class="ext:w-3.5 ext:h-3.5 ext:text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                    />
                  </svg>
                  <span>{{ t('Web Invite Link') }} (OpenCloud)</span>
                </div>
                <div class="ext:flex ext:gap-2">
                  <input
                    type="text"
                    readonly
                    :value="getWebInviteUrl(share.PathOrToken, share.Permissions)"
                    class="ext:flex-1 ext:text-xs ext:bg-white ext:border ext:border-gray-300 ext:rounded ext:p-2 ext:text-gray-700"
                  />
                  <button
                    type="button"
                    class="ext:px-3 ext:py-1 ext:bg-blue-50 ext:text-blue-700 ext:border ext:border-blue-200 ext:text-xs ext:font-medium ext:rounded hover:ext:bg-blue-100 ext:whitespace-nowrap"
                    @click="
                      copyToClipboard(
                        getWebInviteUrl(share.PathOrToken, share.Permissions),
                        'web-' + share.PathOrToken
                      )
                    "
                  >
                    {{
                      copiedKey === 'web-' + share.PathOrToken ? t('Copied!') : t('Copy Web Invite')
                    }}
                  </button>
                </div>
              </div>

              <!-- CalDAV Direct Link -->
              <div>
                <div
                  class="ext:text-xs ext:font-medium ext:text-gray-500 ext:mb-1 ext:flex ext:items-center ext:gap-1.5"
                >
                  <svg
                    class="ext:w-3.5 ext:h-3.5 ext:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span>{{ t('CalDAV Link') }} (Thunderbird, Apple Calendar)</span>
                </div>
                <div class="ext:flex ext:gap-2">
                  <input
                    type="text"
                    readonly
                    :value="getCalDAVUrl(share.PathOrToken)"
                    class="ext:flex-1 ext:text-xs ext:bg-white ext:border ext:border-gray-300 ext:rounded ext:p-2 ext:text-gray-500"
                  />
                  <button
                    type="button"
                    class="ext:px-3 ext:py-1 ext:bg-gray-200 ext:text-gray-700 ext:text-xs ext:font-medium ext:rounded hover:ext:bg-gray-300 ext:whitespace-nowrap"
                    @click="
                      copyToClipboard(
                        getCalDAVUrl(share.PathOrToken),
                        'caldav-' + share.PathOrToken
                      )
                    "
                  >
                    {{
                      copiedKey === 'caldav-' + share.PathOrToken
                        ? t('Copied!')
                        : t('Copy CalDAV URL')
                    }}
                  </button>
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="ext:text-sm ext:text-gray-500 ext:italic">
            {{ t('No public links created yet') }}
          </p>
        </section>
      </div>

      <div class="ext:p-6 ext:border-t ext:border-gray-200 ext:flex ext:justify-end">
        <button
          type="button"
          class="ext:px-4 ext:py-2 ext:bg-gray-100 ext:text-gray-700 ext:text-sm ext:font-medium ext:rounded-md hover:ext:bg-gray-200"
          @click="emit('close')"
        >
          {{ t('Close') }}
        </button>
      </div>
    </div>
  </div>
</template>
