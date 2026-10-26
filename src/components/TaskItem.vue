<script setup lang="ts">
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { isTaskDone, priorityLevel } from '../caldav/tasks'
import { isOverdue } from '../composables/useTasks'
import { toLanguageTag } from '../utils/locale'
import type { Task } from '../types/task'

const props = defineProps<{
  task: Task
  color: string
  readOnly?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  toggle: [task: Task, completed: boolean]
  edit: [task: Task]
  delete: [task: Task]
}>()

const language = useGettext()
const { $gettext } = language

const done = computed(() => isTaskDone(props.task))
const overdue = computed(() => isOverdue(props.task))
const checkboxId = computed(
  () => `web-calendar-task-done-${props.task.href.replace(/[^a-zA-Z0-9_-]/g, '_')}`
)

const dueLabel = computed(() => {
  const due = props.task.due
  if (!due) return ''
  const locale = toLanguageTag(language.current)
  const date = due.toLocaleDateString(locale, {
    weekday: 'short',
    year: due.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    month: 'short',
    day: 'numeric'
  })
  if (props.task.allDay) return date
  return `${date} ${due.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
})

const priority = computed(() => {
  switch (priorityLevel(props.task.priority)) {
    case 'high':
      return $gettext('High priority')
    case 'medium':
      return $gettext('Medium priority')
    case 'low':
      return $gettext('Low priority')
    default:
      return ''
  }
})
</script>

<template>
  <li
    class="ext:flex ext:items-start ext:gap-3 ext:px-3 ext:py-2 ext:border-b ext:border-role-outline-variant ext:last:border-b-0 ext:hover:bg-role-surface-container"
  >
    <!-- The checkbox takes the task list color instead of the primary role -->
    <oc-checkbox
      :id="checkboxId"
      class="ext:mt-0.5"
      :model-value="task.status === 'COMPLETED'"
      :label="$gettext('Completed: %{task}', { task: task.summary })"
      label-hidden
      :disabled="readOnly || busy"
      :style="{ '--color-role-primary': color }"
      @update:model-value="emit('toggle', task, !!$event)"
    />
    <div class="ext:flex-1 ext:min-w-0">
      <oc-button
        appearance="raw"
        no-hover
        class="ext:block ext:w-full ext:text-left ext:justify-start ext:p-0"
        :aria-label="$gettext('Edit task: %{task}', { task: task.summary })"
        @click="emit('edit', task)"
      >
        <span
          class="ext:block ext:truncate ext:text-role-on-surface"
          :class="{ 'ext:line-through ext:text-role-on-surface-variant': done }"
        >
          {{ task.summary || $gettext('(No title)') }}
        </span>
      </oc-button>
      <div
        v-if="
          task.due || priority || task.isRecurring || task.categories.length || task.percentComplete
        "
        class="ext:flex ext:flex-wrap ext:items-center ext:gap-x-3 ext:gap-y-1 ext:mt-0.5 ext:text-xs ext:text-role-on-surface-variant"
      >
        <span
          v-if="task.due"
          class="ext:inline-flex ext:items-center ext:gap-1"
          :class="{ 'ext:text-role-error ext:font-semibold': overdue }"
        >
          <oc-icon name="calendar-event" fill-type="line" size="xsmall" />
          <span>{{ dueLabel }}</span>
          <span v-if="overdue">({{ $gettext('overdue') }})</span>
        </span>
        <span v-if="priority" class="ext:inline-flex ext:items-center ext:gap-1">
          <oc-icon name="flag" fill-type="line" size="xsmall" />
          {{ priority }}
        </span>
        <span v-if="task.isRecurring" class="ext:inline-flex ext:items-center ext:gap-1">
          <oc-icon name="repeat" fill-type="line" size="xsmall" />
          {{ $gettext('Recurring') }}
        </span>
        <span v-if="task.percentComplete && !done">{{ task.percentComplete }}%</span>
        <span
          v-for="category in task.categories"
          :key="category"
          class="ext:px-1.5 ext:rounded-sm ext:bg-role-surface-container-high ext:text-role-on-surface"
        >
          {{ category }}
        </span>
      </div>
    </div>
    <oc-button
      v-if="!readOnly"
      class="ext:shrink-0"
      appearance="raw"
      size="small"
      :aria-label="$gettext('Delete task')"
      :title="$gettext('Delete task')"
      @click="emit('delete', task)"
    >
      <oc-icon name="delete-bin" fill-type="line" size="small" />
    </oc-button>
  </li>
</template>
