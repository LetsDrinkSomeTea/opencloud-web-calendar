import { computed, ref, readonly } from 'vue'
import { useGettext } from 'vue3-gettext'
import * as tasksApi from '../caldav/tasks'
import { isTaskDone } from '../caldav/tasks'
import { useErrorMessage } from './useErrorMessage'
import type { Calendar } from '../types/calendar'
import type { Task, TaskFormData } from '../types/task'

const tasks = ref<Task[]>([])
const loading = ref(false)

/**
 * Whether a collection can hold tasks. Collections that don't advertise a
 * `supported-calendar-component-set` accept all component types (RFC 4791 5.2.3).
 */
export function isTaskList(calendar: Pick<Calendar, 'components'>): boolean {
  return !calendar.components || calendar.components.includes('VTODO')
}

function dueTime(task: Task): number {
  if (!task.due) return Number.POSITIVE_INFINITY
  // A task due on a day sorts after tasks due at a time on that day
  return task.allDay ? task.due.getTime() + 86399999 : task.due.getTime()
}

function priorityRank(task: Task): number {
  return task.priority >= 1 && task.priority <= 9 ? task.priority : 10
}

/** Open tasks first, then by due date (tasks without due date last), priority and title */
export function compareTasks(a: Task, b: Task): number {
  return (
    Number(isTaskDone(a)) - Number(isTaskDone(b)) ||
    dueTime(a) - dueTime(b) ||
    priorityRank(a) - priorityRank(b) ||
    a.summary.localeCompare(b.summary)
  )
}

export interface TaskGroup {
  list: Calendar
  tasks: Task[]
}

/** The tasks per task list, sorted, optionally without completed and cancelled tasks */
export function groupTasks(
  allTasks: readonly Task[],
  lists: readonly Calendar[],
  showCompleted: boolean
): TaskGroup[] {
  return lists.map((list) => ({
    list,
    tasks: allTasks
      .filter((t) => t.calendarHref === list.href && (showCompleted || !isTaskDone(t)))
      .sort(compareTasks)
  }))
}

/** Whether an open task is past its due date (date-only tasks from the next day on) */
export function isOverdue(task: Task, now = new Date()): boolean {
  if (!task.due || isTaskDone(task)) return false
  if (task.allDay) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return task.due.getTime() < today.getTime()
  }
  return task.due.getTime() < now.getTime()
}

export function useTasks() {
  const { $gettext } = useGettext()
  const { showError } = useErrorMessage()

  function replace(updated: Task) {
    tasks.value = tasks.value.map((t) => (t.href === updated.href ? updated : t))
  }

  async function loadTasks(lists: readonly Calendar[]): Promise<void> {
    loading.value = true
    try {
      const results = await Promise.allSettled(lists.map((l) => tasksApi.fetchTasks(l.href)))
      const loaded: Task[] = []
      let failure: unknown = null
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          loaded.push(...result.value)
        } else {
          failure ??= result.reason
          // Keep what we had for this list
          loaded.push(...tasks.value.filter((t) => t.calendarHref === lists[i].href))
        }
      })
      tasks.value = loaded
      if (failure) {
        console.error('Failed to load tasks:', failure)
        showError($gettext('Failed to load tasks'), failure)
      }
    } finally {
      loading.value = false
    }
  }

  async function createTask(data: TaskFormData): Promise<Task | null> {
    try {
      const task = await tasksApi.createTask(data)
      tasks.value = [...tasks.value, task]
      return task
    } catch (err) {
      console.error('Failed to create task:', err)
      showError($gettext('Failed to create the task'), err)
      return null
    }
  }

  async function updateTask(task: Task, data: TaskFormData): Promise<Task | null> {
    try {
      const updated = await tasksApi.updateTask(task, data)
      if (updated.calendarHref === task.calendarHref) replace(updated)
      return updated
    } catch (err) {
      console.error('Failed to update task:', err)
      showError($gettext('Failed to save the task'), err)
      return null
    }
  }

  async function setCompleted(task: Task, completed: boolean): Promise<boolean> {
    try {
      replace(await tasksApi.setTaskCompleted(task, completed))
      return true
    } catch (err) {
      console.error('Failed to update task:', err)
      showError($gettext('Failed to update the task'), err)
      return false
    }
  }

  async function deleteTask(task: Task): Promise<boolean> {
    try {
      await tasksApi.deleteTask(task)
      tasks.value = tasks.value.filter((t) => t.href !== task.href)
      return true
    } catch (err) {
      console.error('Failed to delete task:', err)
      showError($gettext('Failed to delete the task'), err)
      return false
    }
  }

  return {
    tasks: computed(() => tasks.value),
    loading: readonly(loading),
    loadTasks,
    createTask,
    updateTask,
    setCompleted,
    deleteTask
  }
}
