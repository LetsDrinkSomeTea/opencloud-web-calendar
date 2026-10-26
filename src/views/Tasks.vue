<!-- eslint-disable vue/multi-word-component-names -- route view loaded only via the router, never used as a tag -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useModals } from '@opencloud-eu/web-pkg'
import TaskItem from '../components/TaskItem.vue'
import TaskDialog from '../components/TaskDialog.vue'
import { useCalendars } from '../composables/useCalendars'
import { groupTasks, isTaskList, useTasks } from '../composables/useTasks'
import { useModalBinding } from '../composables/useModalBinding'
import { parseDateTimeInput } from '../utils/date'
import type { Calendar } from '../types/calendar'
import type { Task } from '../types/task'

const SHOW_COMPLETED_KEY = 'web-calendar-tasks-show-completed'

const { $gettext } = useGettext()
const { dispatchModal } = useModals()
const { calendars, loading: calendarsLoading, loadCalendars } = useCalendars()
const { tasks, loading, loadTasks, createTask, setCompleted, deleteTask } = useTasks()

const taskLists = computed(() => (calendars.value as Calendar[]).filter(isTaskList))
const writableLists = computed(() => taskLists.value.filter((l) => !l.readOnly))

function readShowCompleted(): boolean {
  try {
    return localStorage.getItem(SHOW_COMPLETED_KEY) === 'true'
  } catch {
    return false
  }
}
const showCompleted = ref(readShowCompleted())
watch(showCompleted, (value) => {
  try {
    localStorage.setItem(SHOW_COMPLETED_KEY, String(value))
  } catch {
    // only a convenience
  }
})

const groups = computed(() => groupTasks(tasks.value, taskLists.value, showCompleted.value))
const openCount = (list: Calendar) =>
  tasks.value.filter(
    (t) => t.calendarHref === list.href && t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
  ).length

// Quick add
const quickTitle = ref('')
const quickDue = ref('')
const quickList = ref('')
const adding = ref(false)

watch(
  writableLists,
  (lists) => {
    if (!lists.some((l) => l.href === quickList.value)) {
      quickList.value = lists[0]?.href ?? ''
    }
  },
  { immediate: true }
)

async function handleQuickAdd() {
  const summary = quickTitle.value.trim()
  if (!summary || !quickList.value || adding.value) return
  adding.value = true
  try {
    const created = await createTask({
      calendarHref: quickList.value,
      summary,
      description: '',
      due: quickDue.value ? parseDateTimeInput(quickDue.value) : null,
      start: null,
      allDay: true,
      priority: 'none',
      status: 'NEEDS-ACTION',
      percentComplete: 0,
      categories: []
    })
    if (created) {
      quickTitle.value = ''
      quickDue.value = ''
    }
  } finally {
    adding.value = false
  }
}

// Completion
const busy = ref(new Set<string>())
async function handleToggle(task: Task, completed: boolean) {
  if (busy.value.has(task.href)) return
  busy.value = new Set(busy.value).add(task.href)
  try {
    await setCompleted(task, completed)
  } finally {
    const next = new Set(busy.value)
    next.delete(task.href)
    busy.value = next
  }
}

// Editing
const editing = ref<{ task: Task | null } | null>(null)

function openCreate() {
  editing.value = { task: null }
}

function handleEdit(task: Task) {
  editing.value = { task }
}

useModalBinding({
  open: () => !!editing.value,
  title: () => (editing.value?.task ? $gettext('Edit Task') : $gettext('New Task')),
  modal: () => {
    const task = editing.value?.task ?? null
    return {
      customComponent: TaskDialog,
      customComponentAttrs: () => ({
        task,
        taskLists: taskLists.value,
        defaultListHref: quickList.value,
        onSaved: () => {
          editing.value = null
        }
      }),
      confirmText: task ? $gettext('Save') : $gettext('Create'),
      confirmDisabled: true,
      focusTrapInitial: '#task-title',
      onCancel: () => {
        editing.value = null
      }
    }
  }
})

function handleDelete(task: Task) {
  dispatchModal({
    title: $gettext('Delete Task'),
    message: task.isRecurring
      ? $gettext(
          "Are you sure you want to delete '%{name}'? All occurrences of this recurring task will be deleted.",
          { name: task.summary }
        )
      : $gettext("Are you sure you want to delete '%{name}'?", { name: task.summary }),
    confirmText: $gettext('Delete'),
    onConfirm: async () => {
      // Failures are reported by `deleteTask`
      await deleteTask(task)
    }
  })
}

async function refresh() {
  await loadCalendars()
  await loadTasks(taskLists.value)
}

onMounted(refresh)

// Task lists added or removed elsewhere (e.g. the calendar list is polled)
watch(
  () => taskLists.value.map((l) => l.href).join(','),
  (value, oldValue) => {
    if (oldValue !== undefined && value !== oldValue) loadTasks(taskLists.value)
  }
)
</script>

<template>
  <div
    class="ext:flex ext:flex-col ext:h-full ext:overflow-hidden ext:bg-role-surface ext:text-role-on-surface"
  >
    <div
      class="ext:flex ext:flex-wrap ext:items-center ext:justify-between ext:gap-2 ext:border-b ext:border-role-outline-variant ext:px-3 ext:sm:px-4 ext:py-2 ext:sm:py-3"
    >
      <h1 class="ext:m-0 ext:text-xl ext:font-semibold">{{ $gettext('Tasks') }}</h1>
      <div class="ext:flex ext:items-center ext:gap-3">
        <oc-checkbox
          id="web-calendar-tasks-show-completed"
          v-model="showCompleted"
          :label="$gettext('Show completed')"
        />
        <oc-button
          appearance="raw"
          :aria-label="$gettext('Refresh')"
          :title="$gettext('Refresh')"
          :disabled="loading || calendarsLoading"
          @click="refresh"
        >
          <oc-spinner v-if="loading || calendarsLoading" size="small" />
          <oc-icon v-else name="refresh" fill-type="line" />
        </oc-button>
        <oc-button
          appearance="filled"
          color-role="primary"
          :disabled="!writableLists.length"
          @click="openCreate"
        >
          <oc-icon name="add" fill-type="line" />
          <span class="ext:hidden ext:sm:inline">{{ $gettext('New task') }}</span>
        </oc-button>
      </div>
    </div>

    <div class="ext:flex-1 ext:overflow-y-auto ext:px-3 ext:sm:px-4 ext:py-4">
      <div class="ext:max-w-3xl ext:mx-auto ext:space-y-6">
        <form
          v-if="writableLists.length"
          class="ext:flex ext:flex-wrap ext:items-end ext:gap-2"
          autocomplete="off"
          @submit.prevent="handleQuickAdd"
        >
          <oc-text-input
            id="web-calendar-quick-task"
            v-model="quickTitle"
            class="ext:flex-1 ext:min-w-48"
            :label="$gettext('Add a task')"
            :placeholder="$gettext('What needs to be done?')"
          />
          <oc-text-input
            id="web-calendar-quick-task-due"
            v-model="quickDue"
            class="ext:w-40"
            type="date"
            :label="$gettext('Due date (optional)')"
          />
          <oc-select
            v-if="writableLists.length > 1"
            id="web-calendar-quick-task-list"
            v-model="quickList"
            class="ext:w-48"
            :label="$gettext('Task list')"
            :options="writableLists"
            option-label="displayName"
            :reduce="(list: Calendar) => list.href"
            :searchable="false"
            :clearable="false"
          />
          <oc-button
            submit="submit"
            appearance="filled"
            color-role="primary"
            :disabled="!quickTitle.trim() || adding"
          >
            {{ $gettext('Add') }}
          </oc-button>
        </form>

        <p
          v-if="!taskLists.length && !(loading || calendarsLoading)"
          class="ext:m-0 ext:text-role-on-surface-variant"
        >
          {{ $gettext('No task lists found. Create a calendar to add tasks.') }}
        </p>

        <section
          v-for="group in groups"
          :key="group.list.href"
          :aria-label="group.list.displayName"
        >
          <h2
            class="ext:m-0 ext:mb-2 ext:flex ext:items-center ext:gap-2 ext:text-sm ext:font-semibold ext:uppercase ext:tracking-wide ext:text-role-on-surface-variant"
          >
            <span
              class="ext:w-3 ext:h-3 ext:rounded-full ext:shrink-0"
              :style="{ backgroundColor: group.list.color }"
              aria-hidden="true"
            />
            <span class="ext:truncate">{{ group.list.displayName }}</span>
            <span class="ext:font-normal">({{ openCount(group.list) }})</span>
            <span v-if="group.list.readOnly" class="ext:font-normal ext:normal-case">
              · {{ $gettext('Read only') }}
            </span>
          </h2>
          <ul
            v-if="group.tasks.length"
            class="ext:list-none ext:m-0 ext:p-0 ext:rounded-md ext:border ext:border-role-outline-variant ext:bg-role-surface"
          >
            <TaskItem
              v-for="task in group.tasks"
              :key="task.href"
              :task="task"
              :color="group.list.color"
              :read-only="group.list.readOnly"
              :busy="busy.has(task.href)"
              @toggle="handleToggle"
              @edit="handleEdit"
              @delete="handleDelete"
            />
          </ul>
          <p v-else class="ext:m-0 ext:text-sm ext:text-role-on-surface-variant">
            {{ showCompleted ? $gettext('No tasks') : $gettext('No open tasks') }}
          </p>
        </section>
      </div>
    </div>
  </div>
</template>
