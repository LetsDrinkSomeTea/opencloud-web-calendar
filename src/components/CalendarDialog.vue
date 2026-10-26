<script setup lang="ts">
import { computed, useId, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import type { Modal } from '@opencloud-eu/web-pkg'
import { useCalendarEditor } from '../composables/useCalendarEditor'
import { translateError } from '../utils/error-message'

/**
 * Content of the "New Calendar" modal (dispatched via `useModals`). The modal's own confirm
 * button creates the calendar through `onConfirm`.
 */
const props = defineProps<{
  modal: Modal
  calendarHomeUrl: string
}>()

const emit = defineEmits<{
  saved: []
  confirm: []
  'update:confirmDisabled': [value: boolean]
}>()

const { $gettext } = useGettext()
const { formData, error, save } = useCalendarEditor()

const formId = `web-calendar-calendar-form-${useId()}`

// Preset colors matching common calendar apps
const presetColors = computed(() => [
  { value: '#3788d8', label: $gettext('Blue') }, // default
  { value: '#22c55e', label: $gettext('Green') },
  { value: '#ef4444', label: $gettext('Red') },
  { value: '#f59e0b', label: $gettext('Orange') },
  { value: '#8b5cf6', label: $gettext('Purple') },
  { value: '#ec4899', label: $gettext('Pink') },
  { value: '#06b6d4', label: $gettext('Cyan') },
  { value: '#84cc16', label: $gettext('Lime') }
])

const isValid = computed(() => !!formData.value.displayName?.trim())

watch(isValid, (valid) => emit('update:confirmDisabled', !valid), { immediate: true })

function handleSubmit() {
  if (!isValid.value || props.modal.isLoading) return
  emit('confirm')
}

/** Called by the modal wrapper on confirm; rejecting keeps the modal open (the error is shown inline) */
async function onConfirm() {
  const success = await save(props.calendarHomeUrl)
  if (!success) {
    return Promise.reject()
  }
  emit('saved')
}

defineExpose({ onConfirm })
</script>

<template>
  <form
    :id="formId"
    class="ext:space-y-4 ext:text-role-on-surface"
    autocomplete="off"
    @submit.prevent="handleSubmit"
  >
    <oc-text-input
      id="calendar-name"
      v-model="formData.displayName"
      :label="$gettext('Calendar Name')"
      :placeholder="$gettext('My Calendar')"
      required-mark
    />

    <oc-textarea
      id="calendar-description"
      v-model="formData.description"
      class="ext:w-full"
      :label="$gettext('Description (optional)')"
      :placeholder="$gettext('Calendar description')"
      rows="2"
    />

    <fieldset class="ext:m-0 ext:p-0 ext:border-0">
      <legend class="ext:p-0 ext:mb-2">{{ $gettext('Color') }}</legend>
      <div class="ext:grid ext:grid-cols-4 sm:ext:grid-cols-8 ext:gap-2">
        <!-- Calendar colors are user data, so the swatches keep their fixed colors -->
        <oc-button
          v-for="color in presetColors"
          :key="color.value"
          appearance="raw"
          no-hover
          class="ext:w-8 ext:h-8 ext:p-0 ext:rounded-full ext:border-2 ext:transition-all"
          :class="
            formData.color === color.value
              ? 'ext:border-role-on-surface ext:scale-110'
              : 'ext:border-role-outline-variant'
          "
          :style="{ backgroundColor: color.value }"
          :aria-label="color.label"
          :title="color.label"
          :aria-pressed="formData.color === color.value ? 'true' : 'false'"
          @click="formData.color = color.value"
        />
      </div>
    </fieldset>

    <oc-color-input
      v-model="formData.color"
      :label="$gettext('Custom color')"
      :clear-button-enabled="false"
    />

    <p v-if="error" class="ext:m-0 ext:text-sm ext:text-role-error" role="alert">
      {{ translateError(error, $gettext) }}
    </p>
  </form>
</template>
