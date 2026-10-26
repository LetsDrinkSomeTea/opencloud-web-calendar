<script setup lang="ts">
import { ref, computed, onMounted, unref, useId } from 'vue'
import { useGettext } from 'vue3-gettext'
import { modalActionsTarget, useRoute, useRouter, type Modal } from '@opencloud-eu/web-pkg'
import { useSharing } from '../composables/useSharing'
import { withCalDAVBasePath } from '../config'
import type { Calendar } from '../types/calendar'
import type { Share } from '../caldav/client'

/** Content of the "Share calendar" modal (dispatched via `useModals`) */
const props = defineProps<{
  modal: Modal
  calendar: Calendar
}>()

const emit = defineEmits<{
  cancel: []
}>()

const { $gettext } = useGettext()

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

const route = useRoute()
const router = useRouter()

const idPrefix = `web-calendar-sharing-${useId()}`

const newUserEmail = ref('')
const newSharePermission = ref('r')
const newLinkPermission = ref('r')
const copiedKey = ref<string | null>(null)

const permissionOptions = computed(() => [
  { value: 'r', label: $gettext('Read') },
  { value: 'rw', label: $gettext('Read & Write') }
])

const reducePermission = (option: { value: string }) => option.value

onMounted(() => {
  fetchShares()
})

// The composable shows its errors in the dialog and rethrows them, so only swallow them here
function ignoreError() {}

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

function handleUpdatePermissions(share: Share, permissions: string) {
  updatePermissions(share, permissions).catch(ignoreError)
}

function handleRemoveShare(share: Share) {
  removeShare(share).catch(ignoreError)
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
  // Same parameters as before, now as a regular route query so the router can read them
  const { href } = router.resolve({
    path: unref(route).path,
    query: {
      join_token: token,
      path: props.calendar.href,
      name: props.calendar.displayName,
      color: props.calendar.color || '#3788d8',
      perm
    }
  })
  return new URL(href, window.location.origin).toString()
}

function getCalDAVUrl(token: string) {
  return `${window.location.origin}${withCalDAVBasePath(token)}`
}
</script>

<template>
  <div class="ext:text-role-on-surface">
    <p
      v-if="error"
      class="ext:m-0 ext:mb-4 ext:p-3 ext:bg-role-error-container ext:text-role-on-error-container ext:text-sm ext:rounded-md"
      role="alert"
    >
      {{ error }}
    </p>

    <!-- Section: Share with users -->
    <section class="ext:mb-8">
      <h3 class="ext:m-0 ext:text-sm ext:font-medium ext:text-role-on-surface-variant ext:mb-3">
        {{ $gettext('Share with users') }}
      </h3>
      <form
        class="ext:flex ext:flex-wrap ext:sm:flex-nowrap ext:items-end ext:gap-2 ext:mb-4"
        @submit.prevent="handleShareWithUser"
      >
        <oc-text-input
          :id="`${idPrefix}-user`"
          v-model="newUserEmail"
          class="ext:flex-1 ext:min-w-48"
          :label="$gettext('User ID or Email')"
          :placeholder="$gettext('User ID or Email')"
        />
        <oc-select
          :id="`${idPrefix}-user-permission`"
          v-model="newSharePermission"
          class="ext:w-40"
          :label="$gettext('Permission')"
          :options="permissionOptions"
          :reduce="reducePermission"
          :searchable="false"
          :clearable="false"
          position-fixed
        />
        <oc-button
          appearance="filled"
          color-role="primary"
          submit="submit"
          :disabled="loading || !newUserEmail"
        >
          {{ $gettext('Invite') }}
        </oc-button>
      </form>

      <ul v-if="userShares.length > 0" class="ext:list-none ext:m-0 ext:p-0 ext:space-y-3">
        <li
          v-for="share in userShares"
          :key="share.PathOrToken"
          class="ext:flex ext:flex-wrap ext:items-center ext:justify-between ext:gap-2 ext:p-3 ext:bg-role-surface-container ext:rounded-lg"
        >
          <div class="ext:flex ext:items-center ext:gap-3 ext:min-w-0">
            <div
              class="ext:w-8 ext:h-8 ext:shrink-0 ext:bg-role-primary-container ext:text-role-on-primary-container ext:rounded-full ext:flex ext:items-center ext:justify-center ext:text-xs ext:font-bold"
              aria-hidden="true"
            >
              {{ (userProfiles[share.User] || share.User).slice(0, 2).toUpperCase() }}
            </div>
            <div class="ext:min-w-0">
              <div class="ext:flex ext:items-center ext:gap-2">
                <span class="ext:text-sm ext:font-medium ext:truncate">{{
                  userProfiles[share.User] || share.User
                }}</span>
                <!-- Status Badges -->
                <span
                  v-if="share.EnabledByUser"
                  class="ext:px-1.5 ext:py-0.5 ext:text-[10px] ext:font-medium ext:bg-role-primary-container ext:text-role-on-primary-container ext:rounded"
                >
                  {{ $gettext('Accepted') }}
                </span>
                <span
                  v-else-if="!share.EnabledByUser && share.HiddenByUser"
                  class="ext:px-1.5 ext:py-0.5 ext:text-[10px] ext:font-medium ext:bg-role-secondary-container ext:text-role-on-secondary-container ext:rounded"
                >
                  {{ $gettext('Invited') }}
                </span>
                <span
                  v-else
                  class="ext:px-1.5 ext:py-0.5 ext:text-[10px] ext:font-medium ext:bg-role-error-container ext:text-role-on-error-container ext:rounded"
                >
                  {{ $gettext('Left') }}
                </span>
              </div>
              <div class="ext:text-xs ext:text-role-on-surface-variant">
                {{ share.Permissions === 'r' ? $gettext('Read only') : $gettext('Read & Write') }}
              </div>
            </div>
          </div>
          <div class="ext:flex ext:items-center ext:gap-2">
            <oc-select
              class="ext:w-40"
              :model-value="share.Permissions"
              :label="$gettext('Permission')"
              label-hidden
              :options="permissionOptions"
              :reduce="reducePermission"
              :searchable="false"
              :clearable="false"
              position-fixed
              @update:model-value="handleUpdatePermissions(share, $event)"
            />
            <oc-button
              class="web-calendar-danger-button"
              appearance="raw"
              :aria-label="$gettext('Remove share')"
              :title="$gettext('Remove share')"
              @click="handleRemoveShare(share)"
            >
              <oc-icon name="delete-bin" fill-type="line" size="small" />
            </oc-button>
          </div>
        </li>
      </ul>
    </section>

    <!-- Section: Invite & Public Links -->
    <section>
      <h3 class="ext:m-0 ext:text-sm ext:font-medium ext:text-role-on-surface-variant ext:mb-3">
        {{ $gettext('Invite & Public links') }}
      </h3>
      <div class="ext:flex ext:items-end ext:gap-2 ext:mb-4">
        <oc-select
          :id="`${idPrefix}-link-permission`"
          v-model="newLinkPermission"
          class="ext:w-40"
          :label="$gettext('Permission')"
          :options="permissionOptions"
          :reduce="reducePermission"
          :searchable="false"
          :clearable="false"
          position-fixed
        />
        <oc-button
          appearance="filled"
          color-role="primary"
          :disabled="loading"
          @click="handleCreatePublicLink"
        >
          {{ $gettext('Create invite link') }}
        </oc-button>
      </div>

      <ul v-if="tokenShares.length > 0" class="ext:list-none ext:m-0 ext:p-0 ext:space-y-4">
        <li
          v-for="share in tokenShares"
          :key="share.PathOrToken"
          class="ext:p-4 ext:bg-role-surface-container ext:rounded-lg ext:border ext:border-role-outline-variant"
        >
          <!-- Link Header: Permissions & Actions -->
          <div class="ext:flex ext:items-center ext:justify-between ext:gap-2 ext:mb-3">
            <div class="ext:flex ext:items-center ext:gap-2">
              <span
                :class="[
                  'ext:px-2 ext:py-0.5 ext:text-xs ext:font-medium ext:rounded-full',
                  share.Permissions === 'rw'
                    ? 'ext:bg-role-primary-container ext:text-role-on-primary-container'
                    : 'ext:bg-role-surface-container-highest ext:text-role-on-surface-variant'
                ]"
              >
                {{ share.Permissions === 'rw' ? $gettext('Read & Write') : $gettext('Read only') }}
              </span>
              <oc-select
                class="ext:w-40"
                :model-value="share.Permissions"
                :label="$gettext('Permission')"
                label-hidden
                :options="permissionOptions"
                :reduce="reducePermission"
                :searchable="false"
                :clearable="false"
                position-fixed
                @update:model-value="handleUpdatePermissions(share, $event)"
              />
            </div>
            <oc-button
              class="web-calendar-danger-button"
              appearance="raw"
              :aria-label="$gettext('Revoke link')"
              :title="$gettext('Revoke link')"
              @click="handleRemoveShare(share)"
            >
              <oc-icon name="delete-bin" fill-type="line" size="small" />
            </oc-button>
          </div>

          <!-- Web Invite Link -->
          <div class="ext:mb-2.5 ext:flex ext:items-end ext:gap-2">
            <oc-text-input
              :id="`${idPrefix}-web-${share.PathOrToken}`"
              class="ext:flex-1 ext:min-w-0"
              :label="`${$gettext('Web Invite Link')} (OpenCloud)`"
              :model-value="getWebInviteUrl(share.PathOrToken, share.Permissions)"
              readonly
            />
            <oc-button
              class="ext:whitespace-nowrap"
              size="small"
              @click="
                copyToClipboard(
                  getWebInviteUrl(share.PathOrToken, share.Permissions),
                  'web-' + share.PathOrToken
                )
              "
            >
              <oc-icon
                :name="copiedKey === 'web-' + share.PathOrToken ? 'check' : 'file-copy'"
                fill-type="line"
                size="small"
              />
              <span aria-live="polite">
                {{
                  copiedKey === 'web-' + share.PathOrToken
                    ? $gettext('Copied!')
                    : $gettext('Copy Web Invite')
                }}
              </span>
            </oc-button>
          </div>

          <!-- CalDAV Direct Link -->
          <div class="ext:flex ext:items-end ext:gap-2">
            <oc-text-input
              :id="`${idPrefix}-caldav-${share.PathOrToken}`"
              class="ext:flex-1 ext:min-w-0"
              :label="`${$gettext('CalDAV Link')} (Thunderbird, Apple Calendar)`"
              :model-value="getCalDAVUrl(share.PathOrToken)"
              readonly
            />
            <oc-button
              class="ext:whitespace-nowrap"
              size="small"
              @click="
                copyToClipboard(getCalDAVUrl(share.PathOrToken), 'caldav-' + share.PathOrToken)
              "
            >
              <oc-icon
                :name="copiedKey === 'caldav-' + share.PathOrToken ? 'check' : 'file-copy'"
                fill-type="line"
                size="small"
              />
              <span aria-live="polite">
                {{
                  copiedKey === 'caldav-' + share.PathOrToken
                    ? $gettext('Copied!')
                    : $gettext('Copy CalDAV URL')
                }}
              </span>
            </oc-button>
          </div>
        </li>
      </ul>
      <p v-else class="ext:m-0 ext:text-sm ext:text-role-on-surface-variant ext:italic">
        {{ $gettext('No public links created yet') }}
      </p>
    </section>

    <teleport defer :to="`#${modalActionsTarget(modal)}`">
      <oc-button class="ext:ml-2" @click="emit('cancel')">
        {{ $gettext('Close') }}
      </oc-button>
    </teleport>
  </div>
</template>
