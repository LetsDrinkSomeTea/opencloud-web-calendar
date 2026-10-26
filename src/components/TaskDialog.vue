<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import type { Modal } from '@opencloud-eu/web-pkg'
import { taskToFormData } from '../caldav/tasks'
import { useTasks } from '../composables/useTasks'
import { formatDateForInput, formatTimeForInput, parseDateTimeInput } from '../utils/date'
import type { Calendar } from '../types/calendar'
import type { Task, TaskFormData, TaskPriority, TaskStatus } from '../types/task'

/**
 * Content of the task modal (dispatched via `useModals`). Creates a task or edits all fields of
 * an existing one; the modal's confirm button saves through `onConfirm`.
 */
const props = defineProps<{
  modal: Modal
  task: Task | null
  taskLists: readonly Calendar[]
  defaultListHref?: string
}>()

const emit = defineEmits<{
  saved: [task: Task]
  confirm: []
  'update:confirmDisabled': [value: boolean]
}>()

const { $gettext } = useGettext()
const { createTask, updateTask } = useTasks()

const formId = `web-calendar-task-form-${useId()}`

const initial: TaskFormData = props.task
  ? taskToFormData(props.task)
  : {
      calendarHref: props.defaultListHref || props.taskLists[0]?.href || '',
      summary: '',
      description: '',
      due: null,
      start: null,
      allDay: true,
      priority: 'none',
      status: 'NEEDS-ACTION',
      percentComplete: 0,
      categories: []
    }

const calendarHref = ref(initial.calendarHref)
const summary = ref(initial.summary)
const description = ref(initial.description)
const allDay = ref(initial.allDay)
const startDate = ref(initial.start ? formatDateForInput(initial.start) : '')
const startTime = ref(
  initial.start && !initial.allDay ? formatTimeForInput(initial.start) : '09:00'
)
const dueDate = ref(initial.due ? formatDateForInput(initial.due) : '')
const dueTime = ref(initial.due && !initial.allDay ? formatTimeForInput(initial.due) : '17:00')
const priority = ref<TaskPriority>(initial.priority)
const status = ref<TaskStatus>(initial.status)
const percentComplete = ref(String(initial.percentComplete || 0))
const categories = ref(initial.categories.join(', '))

const writableLists = computed(() => props.taskLists.filter((l) => !l.readOnly))

const priorityOptions = computed(() => [
  { value: 'none', label: $gettext('None') },
  { value: 'high', label: $gettext('High') },
  { value: 'medium', label: $gettext('Medium') },
  { value: 'low', label: $gettext('Low') }
])

const statusOptions = computed(() => [
  { value: 'NEEDS-ACTION', label: $gettext('Needs action') },
  { value: 'IN-PROCESS', label: $gettext('In progress') },
  { value: 'COMPLETED', label: $gettext('Completed') },
  { value: 'CANCELLED', label: $gettext('Cancelled') }
])

function toDate(date: string, time: string): Date | null {
  if (!date) return null
  return parseDateTimeInput(date, allDay.value ? undefined : time || '00:00')
}

const start = computed(() => toDate(startDate.value, startTime.value))
const due = computed(() => toDate(dueDate.value, dueTime.value))

const dateError = computed(() =>
  start.value && due.value && start.value.getTime() > due.value.getTime()
    ? $gettext('The start must not be after the due date.')
    : ''
)

const percentValue = computed(() => {
  const value = Math.round(Number(percentComplete.value))
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
})

const isValid = computed(() => !!summary.value.trim() && !!calendarHref.value && !dateError.value)

watch(isValid, (valid) => emit('update:confirmDisabled', !valid), { immediate: true })

function handleSubmit() {
  if (!isValid.value || props.modal.isLoading) return
  emit('confirm')
}

function formData(): TaskFormData {
  return {
    calendarHref: calendarHref.value,
    summary: summary.value.trim(),
    description: description.value,
    due: due.value,
    start: start.value,
    allDay: allDay.value,
    priority: priority.value,
    status: status.value,
    percentComplete: percentValue.value,
    categories: categories.value
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
  }
}

/** Called by the modal wrapper on confirm; rejecting keeps the modal open */
async function onConfirm() {
  const data = formData()
  // Failures are reported by `useTasks`
  const saved = props.task ? await updateTask(props.task, data) : await createTask(data)
  if (!saved) {
    return Promise.reject()
  }
  emit('saved', saved)
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
      id="task-title"
      v-model="summary"
      :label="$gettext('Title')"
      :placeholder="$gettext('Task title')"
      required-mark
    />

    <oc-select
      v-if="!task"
      id="task-list"
      v-model="calendarHref"
      :label="$gettext('Task list')"
      :options="writableLists"
      option-label="displayName"
      :reduce="(list: Calendar) => list.href"
      :searchable="false"
      :clearable="false"
      position-fixed
    />

    <p
      v-if="task?.isRecurring"
      class="ext:m-0 ext:text-sm ext:text-role-on-surface-variant"
      role="note"
    >
      {{
        $gettext(
          'This is a recurring task. Changes apply to all occurrences, the dates shown are those of the first occurrence.'
        )
      }}
    </p>

    <oc-checkbox id="task-allday" v-model="allDay" :label="$gettext('All day')" />

    <div :class="allDay ? 'ext:grid ext:grid-cols-1' : 'ext:grid ext:grid-cols-2 ext:gap-4'">
      <oc-text-input
        id="task-start-date"
        v-model="startDate"
        type="date"
        :label="$gettext('Start date (optional)')"
      />
      <div v-if="!allDay">
        <label for="task-start-time" class="ext:inline-block ext:mb-0.5">
          {{ $gettext('Start time') }}
        </label>
        <input
          id="task-start-time"
          v-model="startTime"
          type="time"
          :disabled="!startDate"
          class="oc-text-input oc-input ext:h-9"
        />
      </div>
    </div>

    <div :class="allDay ? 'ext:grid ext:grid-cols-1' : 'ext:grid ext:grid-cols-2 ext:gap-4'">
      <oc-text-input
        id="task-due-date"
        v-model="dueDate"
        type="date"
        :label="$gettext('Due date (optional)')"
      />
      <div v-if="!allDay">
        <label for="task-due-time" class="ext:inline-block ext:mb-0.5">
          {{ $gettext('Due time') }}
        </label>
        <input
          id="task-due-time"
          v-model="dueTime"
          type="time"
          :disabled="!dueDate"
          class="oc-text-input oc-input ext:h-9"
        />
      </div>
    </div>

    <p v-if="dateError" class="ext:m-0 ext:text-sm ext:text-role-error" role="alert">
      {{ dateError }}
    </p>

    <div class="ext:grid ext:grid-cols-1 ext:sm:grid-cols-2 ext:gap-4">
      <oc-select
        id="task-priority"
        v-model="priority"
        :label="$gettext('Priority')"
        :options="priorityOptions"
        :reduce="(option: { value: string }) => option.value"
        :searchable="false"
        :clearable="false"
        position-fixed
      />
      <oc-select
        id="task-status"
        v-model="status"
        :label="$gettext('Status')"
        :options="statusOptions"
        :reduce="(option: { value: string }) => option.value"
        :searchable="false"
        :clearable="false"
        position-fixed
      />
    </div>

    <oc-text-input
      v-if="status === 'IN-PROCESS' || status === 'NEEDS-ACTION'"
      id="task-percent"
      v-model="percentComplete"
      type="number"
      min="0"
      max="100"
      :label="$gettext('Percent complete')"
    />

    <oc-text-input
      id="task-categories"
      v-model="categories"
      :label="$gettext('Categories')"
      :description-message="$gettext('Separate multiple categories with commas')"
    />

    <oc-textarea
      id="task-description"
      v-model="description"
      class="ext:w-full"
      :label="$gettext('Description')"
      rows="3"
    />
  </form>
</template>
