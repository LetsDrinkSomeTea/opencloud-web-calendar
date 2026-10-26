<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { modalActionsTarget, type Modal } from '@opencloud-eu/web-pkg'
import { useICSImport, type ImportMode } from '../composables/useICSImport'
import type { Calendar } from '../types/calendar'

/**
 * Content of the "Import Calendar" modal (dispatched via `useModals`). The import keeps the modal
 * open to show its report, so the footer buttons are teleported into the modal's actions row
 * instead of using the modal's confirm button (which would close it).
 */
const props = defineProps<{
  modal: Modal
  calendars: readonly Calendar[]
  calendarHomeUrl: string
  defaultCalendar: Calendar | null
}>()

const emit = defineEmits<{
  imported: []
  cancel: []
}>()

const { $gettext } = useGettext()
const { phase, progress, report, error, importFile } = useICSImport()

const selectedFiles = ref<FileList | null>(null)
const importMode = ref<ImportMode>('new-calendar')
const newCalendarName = ref('')
const selectedMergeCalendarHref = ref<string | null>(null)
const showDetails = ref(false)

const selectedFile = computed(() => selectedFiles.value?.[0] ?? null)
const selectedMergeCalendar = computed(
  () => props.calendars.find((c) => c.href === selectedMergeCalendarHref.value) ?? null
)

// Pre-select default calendar when switching to merge mode
watch(importMode, (mode) => {
  if (mode === 'merge' && !selectedMergeCalendarHref.value && props.defaultCalendar) {
    selectedMergeCalendarHref.value = props.defaultCalendar.href
  }
})

// Suggest calendar name from filename
watch(selectedFile, (file) => {
  if (file && importMode.value === 'new-calendar' && !newCalendarName.value) {
    newCalendarName.value = file.name.replace(/\.ics$/i, '')
  }
})

const isBusy = computed(() =>
  ['reading', 'parsing', 'analyzing', 'importing'].includes(phase.value)
)

const canImport = computed(() => {
  if (!selectedFile.value) return false
  if (importMode.value === 'new-calendar' && !newCalendarName.value.trim()) return false
  if (importMode.value === 'merge' && !selectedMergeCalendar.value) return false
  return true
})

const progressPercent = computed(() => {
  if (progress.value.total === 0) return 0
  return Math.round((progress.value.current / progress.value.total) * 100)
})

const resultTypeLabels = computed<Record<string, string>>(() => ({
  created: $gettext('Created'),
  updated: $gettext('Updated'),
  skipped: $gettext('Skipped'),
  failed: $gettext('Failed')
}))

const resultTypeClasses: Record<string, string> = {
  created: 'ext:bg-role-primary ext:text-role-on-primary',
  updated: 'ext:bg-role-secondary ext:text-role-on-secondary',
  skipped: 'ext:bg-role-surface-container-highest ext:text-role-on-surface-variant',
  failed: 'ext:bg-role-error ext:text-role-on-error'
}

async function handleImport() {
  if (!selectedFile.value || !canImport.value) return

  await importFile(
    selectedFile.value,
    importMode.value,
    newCalendarName.value,
    importMode.value === 'merge' ? selectedMergeCalendar.value : null,
    props.calendarHomeUrl,
    props.calendars
  )

  if (phase.value === 'done') {
    emit('imported')
  }
}
</script>

<template>
  <div class="ext:space-y-4 ext:text-role-on-surface">
    <!-- Phase: idle / error — show form -->
    <form
      v-if="phase === 'idle' || phase === 'error'"
      id="web-calendar-import-form"
      class="ext:space-y-4"
      @submit.prevent="handleImport"
    >
      <oc-file-input
        id="web-calendar-import-file"
        v-model="selectedFiles"
        :label="$gettext('ICS File')"
        file-types=".ics,text/calendar"
        preview-icon="calendar"
        preview-icon-fill-type="line"
        :description-message="
          selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : undefined
        "
      />

      <!-- Mode selection -->
      <fieldset class="ext:m-0 ext:p-0 ext:border-0 ext:space-y-2">
        <legend class="ext:p-0 ext:mb-2">{{ $gettext('Import mode') }}</legend>
        <div>
          <oc-radio
            id="mode-new"
            v-model="importMode"
            option="new-calendar"
            :label="$gettext('Create new calendar')"
          />
        </div>
        <div>
          <oc-radio
            id="mode-merge"
            v-model="importMode"
            option="merge"
            :disabled="calendars.length === 0"
            :label="$gettext('Merge into existing calendar')"
          />
        </div>
      </fieldset>

      <!-- Calendar selector (merge mode) -->
      <oc-select
        v-if="importMode === 'merge'"
        id="merge-target"
        v-model="selectedMergeCalendarHref"
        :label="$gettext('Target calendar')"
        :placeholder="$gettext('Select calendar')"
        :options="calendars"
        option-label="displayName"
        :reduce="(cal: Calendar) => cal.href"
        :searchable="false"
        :clearable="false"
        position-fixed
      />

      <!-- Calendar name (new calendar mode) -->
      <oc-text-input
        v-if="importMode === 'new-calendar'"
        id="import-cal-name"
        v-model="newCalendarName"
        :label="$gettext('Calendar Name')"
        :placeholder="$gettext('Enter calendar name')"
        required-mark
      />

      <!-- Error display -->
      <p
        v-if="error"
        class="ext:m-0 ext:p-3 ext:bg-role-error-container ext:text-role-on-error-container ext:rounded ext:text-sm ext:whitespace-pre-line"
        role="alert"
      >
        {{ error }}
      </p>
    </form>

    <!-- Phase: reading/parsing/analyzing/importing — show progress -->
    <div v-if="isBusy" class="ext:space-y-3" aria-live="polite">
      <p class="ext:m-0 ext:text-sm">
        <template v-if="phase === 'reading'">{{ $gettext('Reading file...') }}</template>
        <template v-else-if="phase === 'parsing'">{{ $gettext('Parsing events...') }}</template>
        <template v-else-if="phase === 'analyzing'">{{
          $gettext('Analyzing for duplicates...')
        }}</template>
        <template v-else-if="phase === 'importing'">
          {{ $gettext('Importing events...') }} ({{ progress.current }}/{{ progress.total }})
        </template>
      </p>
      <oc-progress
        :value="progressPercent"
        :max="100"
        :indeterminate="phase !== 'importing'"
        color="var(--oc-role-primary)"
        size="small"
      />
    </div>

    <!-- Phase: done — show report -->
    <div v-if="phase === 'done' && report" class="ext:space-y-3">
      <!-- Summary -->
      <div class="ext:grid ext:grid-cols-2 ext:gap-2">
        <div
          class="ext:p-3 ext:bg-role-primary-container ext:text-role-on-primary-container ext:rounded ext:text-center"
        >
          <div class="ext:text-2xl ext:font-bold">{{ report.created }}</div>
          <div class="ext:text-xs">{{ $gettext('Created') }}</div>
        </div>
        <div
          v-if="report.mode === 'merge'"
          class="ext:p-3 ext:bg-role-secondary-container ext:text-role-on-secondary-container ext:rounded ext:text-center"
        >
          <div class="ext:text-2xl ext:font-bold">{{ report.updated }}</div>
          <div class="ext:text-xs">{{ $gettext('Updated') }}</div>
        </div>
        <div
          v-if="report.skipped > 0"
          class="ext:p-3 ext:bg-role-surface-container-high ext:text-role-on-surface ext:rounded ext:text-center"
        >
          <div class="ext:text-2xl ext:font-bold">{{ report.skipped }}</div>
          <div class="ext:text-xs">{{ $gettext('Skipped') }}</div>
        </div>
        <div
          v-if="report.failed > 0"
          class="ext:p-3 ext:bg-role-error-container ext:text-role-on-error-container ext:rounded ext:text-center"
        >
          <div class="ext:text-2xl ext:font-bold">{{ report.failed }}</div>
          <div class="ext:text-xs">{{ $gettext('Failed') }}</div>
        </div>
      </div>

      <p class="ext:m-0 ext:text-sm ext:text-role-on-surface-variant">
        {{
          $ngettext(
            'Imported %{count} event into "%{name}"',
            'Imported %{count} events into "%{name}"',
            report.created + report.updated,
            {
              count: String(report.created + report.updated),
              name: report.calendarName
            }
          )
        }}
      </p>

      <!-- Parse errors -->
      <div
        v-if="report.errors.length > 0"
        class="ext:p-3 ext:bg-role-tertiary-container ext:text-role-on-tertiary-container ext:rounded"
      >
        <p class="ext:m-0 ext:text-sm ext:font-medium ext:mb-1">
          {{ $gettext('Parse warnings') }}
        </p>
        <ul class="ext:m-0 ext:pl-4 ext:text-xs ext:space-y-0.5">
          <li v-for="(err, i) in report.errors" :key="i">{{ err }}</li>
        </ul>
      </div>

      <!-- Details toggle -->
      <oc-button
        v-if="report.results.length > 0"
        appearance="raw"
        color-role="primary"
        size="small"
        :aria-expanded="showDetails ? 'true' : 'false'"
        aria-controls="web-calendar-import-details"
        @click="showDetails = !showDetails"
      >
        {{ showDetails ? $gettext('Hide details') : $gettext('Show details') }}
      </oc-button>

      <!-- Detailed results -->
      <div
        v-if="showDetails"
        id="web-calendar-import-details"
        class="ext:max-h-48 ext:overflow-y-auto ext:border ext:border-role-outline-variant ext:rounded"
      >
        <table class="ext:w-full ext:text-xs">
          <tbody>
            <tr
              v-for="(result, i) in report.results"
              :key="i"
              class="ext:border-b ext:border-role-outline-variant"
            >
              <td class="ext:px-2 ext:py-1">
                <span
                  class="ext:inline-block ext:px-1.5 ext:py-0.5 ext:rounded ext:text-[10px] ext:font-medium"
                  :class="resultTypeClasses[result.type]"
                >
                  {{ resultTypeLabels[result.type] ?? result.type }}
                </span>
              </td>
              <td class="ext:px-2 ext:py-1 ext:truncate ext:max-w-[200px]">
                {{ result.summary }}
              </td>
              <td
                v-if="'reason' in result || 'error' in result"
                class="ext:px-2 ext:py-1 ext:text-role-on-surface-variant"
              >
                {{ 'reason' in result ? result.reason : '' }}
                {{ 'error' in result ? result.error : '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <teleport defer :to="`#${modalActionsTarget(modal)}`">
      <template v-if="phase === 'idle' || phase === 'error'">
        <oc-button class="ext:ml-2" @click="emit('cancel')">
          {{ $gettext('Cancel') }}
        </oc-button>
        <oc-button
          class="ext:ml-2"
          appearance="filled"
          color-role="primary"
          submit="submit"
          form="web-calendar-import-form"
          :disabled="!canImport"
        >
          {{ $gettext('Import') }}
        </oc-button>
      </template>
      <oc-button v-else-if="phase === 'done'" class="ext:ml-2" @click="emit('cancel')">
        {{ $gettext('Close') }}
      </oc-button>
    </teleport>
  </div>
</template>
