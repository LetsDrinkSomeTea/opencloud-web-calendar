<script setup lang="ts">
import type { Modal } from '@opencloud-eu/web-pkg'
import { useEventEditor } from '../composables/useEventEditor'

/** Content of the "Edit Recurring Event" modal, asks whether to edit one occurrence or the series */
defineProps<{
  modal: Modal
}>()

const { selectEditScope } = useEventEditor()
</script>

<template>
  <div class="ext:space-y-3 ext:text-role-on-surface">
    <p class="ext:m-0 ext:text-sm ext:text-role-on-surface-variant">
      {{ $gettext('This is a recurring event. What would you like to edit?') }}
    </p>
    <oc-button
      class="ext:w-full"
      justify-content="left"
      color-role="surfaceContainer"
      appearance="filled"
      @click="selectEditScope('single')"
    >
      <oc-icon name="calendar-event" fill-type="line" size="small" />
      {{ $gettext('This event only') }}
    </oc-button>
    <oc-button
      class="ext:w-full"
      justify-content="left"
      color-role="surfaceContainer"
      appearance="filled"
      @click="selectEditScope('series')"
    >
      <oc-icon name="repeat" fill-type="line" size="small" />
      {{ $gettext('All events in series') }}
    </oc-button>
  </div>
</template>
