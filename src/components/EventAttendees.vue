<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useUserStore } from '@opencloud-eu/web-pkg'
import type { User } from '@opencloud-eu/web-client/graph/generated'
import type { EventAttendee, EventOrganizer, ParticipationStatus } from '../types/calendar'
import { findAttendee, isOrganizer, setParticipationStatus } from '../caldav/attendees'
import { useUserProfiles } from '../composables/useUserProfiles'

/** Attendees (`ATTENDEE`) and organizer (`ORGANIZER`) of the event form */
const props = defineProps<{
  attendees: EventAttendee[]
  organizer?: EventOrganizer
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:attendees': [attendees: EventAttendee[]]
  'update:organizer': [organizer: EventOrganizer | undefined]
  'download-invitation': []
}>()

const { $gettext } = useGettext()
const userStore = useUserStore()
const { searchUsers } = useUserProfiles()

const inputId = `web-calendar-attendee-${useId()}`
const listId = `web-calendar-attendee-results-${useId()}`

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const query = ref('')
const results = ref<User[]>([])
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSeq = 0

const currentUserMail = computed(() => userStore.user?.mail || null)

const ownAttendee = computed(() => findAttendee(props.attendees, currentUserMail.value))
const canRespond = computed(
  () => !!ownAttendee.value && !isOrganizer(props.organizer, currentUserMail.value)
)

/** Only the organizer changes the list of attendees; others can only respond */
const canEdit = computed(
  () => !props.disabled && (!props.organizer || isOrganizer(props.organizer, currentUserMail.value))
)

const statusLabels = computed<Record<string, string>>(() => ({
  'NEEDS-ACTION': $gettext('Awaiting response'),
  ACCEPTED: $gettext('Accepted'),
  DECLINED: $gettext('Declined'),
  TENTATIVE: $gettext('Maybe'),
  DELEGATED: $gettext('Delegated')
}))

const responses = computed<{ value: ParticipationStatus; label: string }[]>(() => [
  { value: 'ACCEPTED', label: $gettext('Accept') },
  { value: 'TENTATIVE', label: $gettext('Maybe') },
  { value: 'DECLINED', label: $gettext('Decline') }
])

function statusLabel(attendee: EventAttendee): string {
  return statusLabels.value[attendee.partstat] || attendee.partstat.toLowerCase()
}

function statusIcon(partstat: string): string {
  switch (partstat) {
    case 'ACCEPTED':
      return 'checkbox-circle'
    case 'DECLINED':
      return 'close-circle'
    case 'TENTATIVE':
      return 'question'
    default:
      return 'time'
  }
}

function clearSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
  searchSeq++
  results.value = []
}

function handleInput(value: string) {
  query.value = value
  if (searchTimer) clearTimeout(searchTimer)
  const term = value.trim()
  if (term.length < 2) {
    clearSearch()
    return
  }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq
    try {
      const users = await searchUsers(term)
      if (seq === searchSeq) {
        results.value = users.filter((u) => !!u.mail)
      }
    } catch {
      // Search is a convenience, plain addresses can still be added
      if (seq === searchSeq) results.value = []
    }
  }, 300)
}

function handleBlur() {
  // Delay clearing results to allow the click on a suggestion
  setTimeout(clearSearch, 200)
}

onBeforeUnmount(clearSearch)

function addAttendee(email: string, name?: string) {
  const address = email.trim()
  if (!EMAIL_PATTERN.test(address)) return
  query.value = ''
  clearSearch()
  if (findAttendee(props.attendees, address)) return

  // The current user organizes events they invite others to
  const user = userStore.user
  if (!props.organizer && user?.mail) {
    emit('update:organizer', {
      email: user.mail,
      ...(user.displayName && { name: user.displayName })
    })
  }
  emit('update:attendees', [
    ...props.attendees,
    {
      email: address,
      ...(name && { name }),
      partstat: 'NEEDS-ACTION',
      role: 'REQ-PARTICIPANT',
      rsvp: true,
      cutype: 'INDIVIDUAL'
    }
  ])
}

const canAddQuery = computed(() => EMAIL_PATTERN.test(query.value.trim()))

function handleEnter() {
  if (results.value.length === 1 && results.value[0].mail) {
    addAttendee(results.value[0].mail, results.value[0].displayName || undefined)
  } else if (canAddQuery.value) {
    addAttendee(query.value)
  }
}

function removeAttendee(index: number) {
  const attendees = props.attendees.filter((_, i) => i !== index)
  emit('update:attendees', attendees)
  // Without attendees the event is no longer a group scheduled event
  if (attendees.length === 0 && isOrganizer(props.organizer, currentUserMail.value)) {
    emit('update:organizer', undefined)
  }
}

function respond(partstat: ParticipationStatus) {
  if (!currentUserMail.value) return
  emit('update:attendees', setParticipationStatus(props.attendees, currentUserMail.value, partstat))
}
</script>

<template>
  <fieldset class="web-calendar-event-attendees ext:m-0 ext:p-0 ext:border-0 ext:space-y-2">
    <legend class="ext:p-0 ext:mb-2 ext:font-medium">{{ $gettext('Attendees') }}</legend>

    <!-- Response of the current user -->
    <div
      v-if="canRespond && ownAttendee"
      class="ext:flex ext:flex-wrap ext:items-center ext:gap-2"
      role="group"
      :aria-label="$gettext('Your response')"
    >
      <span class="ext:text-sm">{{ $gettext('Your response:') }}</span>
      <oc-button
        v-for="response in responses"
        :key="response.value"
        size="small"
        :disabled="disabled"
        :appearance="ownAttendee.partstat === response.value ? 'filled' : 'outline'"
        :color-role="ownAttendee.partstat === response.value ? 'primary' : 'secondary'"
        :aria-pressed="ownAttendee.partstat === response.value ? 'true' : 'false'"
        @click="respond(response.value)"
      >
        {{ response.label }}
      </oc-button>
    </div>

    <p v-if="organizer && attendees.length > 0" class="ext:m-0 ext:text-sm">
      {{ $gettext('Organizer: %{name}', { name: organizer.name || organizer.email }) }}
    </p>

    <ul v-if="attendees.length > 0" class="ext:m-0 ext:p-0 ext:list-none ext:space-y-1">
      <li
        v-for="(attendee, index) in attendees"
        :key="attendee.email"
        class="ext:flex ext:items-center ext:justify-between ext:gap-2 ext:text-sm"
      >
        <span class="ext:flex ext:items-center ext:gap-2 ext:min-w-0">
          <oc-icon
            :name="statusIcon(attendee.partstat)"
            fill-type="line"
            size="small"
            class="ext:shrink-0"
          />
          <span class="ext:truncate" :title="attendee.email">
            {{ attendee.name || attendee.email }}
          </span>
          <span class="ext:shrink-0 ext:text-role-on-surface-variant">
            {{ statusLabel(attendee) }}
          </span>
        </span>
        <oc-button
          v-if="canEdit"
          appearance="raw"
          size="small"
          :aria-label="
            $gettext('Remove attendee %{name}', { name: attendee.name || attendee.email })
          "
          :title="$gettext('Remove attendee')"
          @click="removeAttendee(index)"
        >
          <oc-icon name="close" size="small" />
        </oc-button>
      </li>
    </ul>

    <div v-if="canEdit" class="ext:relative">
      <div class="ext:flex ext:items-end ext:gap-2">
        <oc-text-input
          :id="inputId"
          class="ext:flex-1"
          :model-value="query"
          :label="$gettext('Add attendee')"
          label-hidden
          :placeholder="$gettext('Search users or enter an email address')"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="results.length > 0 ? 'true' : 'false'"
          :aria-controls="listId"
          @update:model-value="handleInput"
          @keydown.enter.prevent="handleEnter"
          @blur="handleBlur"
        />
        <oc-button size="small" :disabled="!canAddQuery" @click="addAttendee(query)">
          {{ $gettext('Add') }}
        </oc-button>
      </div>
      <ul
        v-if="results.length > 0"
        :id="listId"
        role="listbox"
        :aria-label="$gettext('User suggestions')"
        class="ext:absolute ext:z-50 ext:w-full ext:mt-1 ext:p-1 ext:list-none ext:bg-role-surface ext:border ext:border-role-outline-variant ext:rounded ext:shadow-lg ext:max-h-60 ext:overflow-y-auto"
      >
        <li v-for="user in results" :key="user.id" role="option">
          <oc-button
            class="ext:w-full ext:text-left ext:text-sm"
            appearance="raw"
            justify-content="left"
            @click="addAttendee(user.mail || '', user.displayName || undefined)"
          >
            {{ user.displayName }} &lt;{{ user.mail }}&gt;
          </oc-button>
        </li>
      </ul>
    </div>

    <p
      v-if="attendees.length > 0"
      class="ext:m-0 ext:text-sm ext:text-role-on-surface-variant ext:flex ext:flex-wrap ext:items-center ext:gap-2"
    >
      <span>
        {{
          $gettext(
            'Invitations are not sent by the calendar. Attendees are only notified if email notifications are enabled on the server.'
          )
        }}
      </span>
      <oc-button appearance="raw" size="small" @click="emit('download-invitation')">
        {{ $gettext('Download invitation') }}
      </oc-button>
    </p>
  </fieldset>
</template>
