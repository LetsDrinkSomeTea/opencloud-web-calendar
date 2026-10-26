import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createTestGettext } from './helpers/design-system'
import { messageStore, resetStores } from './helpers/web-pkg'
import {
  compareTasks,
  groupTasks,
  isOverdue,
  isTaskList,
  useTasks
} from '../../src/composables/useTasks'
import type { Calendar } from '../../src/types/calendar'
import type { Task, TaskFormData } from '../../src/types/task'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const api = vi.hoisted(() => ({
  fetchTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  setTaskCompleted: vi.fn(),
  deleteTask: vi.fn()
}))

vi.mock('../../src/caldav/tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/caldav/tasks')>()),
  ...api
}))

function task(overrides: Partial<Task> = {}): Task {
  return {
    uid: 'uid',
    calendarHref: '/a/',
    href: `/a/${Math.random()}.ics`,
    etag: 'e',
    summary: 'Task',
    allDay: true,
    priority: 0,
    status: 'NEEDS-ACTION',
    percentComplete: 0,
    categories: [],
    isRecurring: false,
    icsData: '',
    ...overrides
  }
}

const list = (href: string, components?: string[]): Calendar => ({
  href,
  displayName: href,
  color: '#000',
  ctag: '',
  visible: true,
  components
})

function setup() {
  let result!: ReturnType<typeof useTasks>
  mount(
    defineComponent({
      setup() {
        result = useTasks()
        return () => h('div')
      }
    }),
    { global: { plugins: [createTestGettext()] } }
  )
  return result
}

beforeEach(() => {
  resetStores()
  Object.values(api).forEach((fn) => fn.mockReset())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('isTaskList', () => {
  it('accepts collections supporting VTODO or not advertising components', () => {
    expect(isTaskList(list('/a/', ['VEVENT', 'VTODO']))).toBe(true)
    expect(isTaskList(list('/a/'))).toBe(true)
    expect(isTaskList(list('/a/', ['VEVENT']))).toBe(false)
  })
})

describe('sorting and grouping', () => {
  const day = (d: number, h = 0) => new Date(2026, 2, d, h)

  it('sorts open before done, then by due date, priority and title', () => {
    const tasks = [
      task({ summary: 'done', status: 'COMPLETED', due: day(1) }),
      task({ summary: 'no due' }),
      task({ summary: 'day 2 all-day', due: day(2) }),
      task({ summary: 'day 2 10:00', due: day(2, 10), allDay: false }),
      task({ summary: 'day 1 b', due: day(1) }),
      task({ summary: 'day 1 a', due: day(1) }),
      task({ summary: 'day 1 high', due: day(1), priority: 1 })
    ]
    expect([...tasks].sort(compareTasks).map((t) => t.summary)).toEqual([
      'day 1 high',
      'day 1 a',
      'day 1 b',
      'day 2 10:00',
      'day 2 all-day',
      'no due',
      'done'
    ])
  })

  it('groups by task list and hides completed tasks unless requested', () => {
    const tasks = [
      task({ calendarHref: '/a/', summary: 'a1' }),
      task({ calendarHref: '/b/', summary: 'b1', status: 'CANCELLED' }),
      task({ calendarHref: '/b/', summary: 'b2' })
    ]
    const lists = [list('/a/'), list('/b/')]
    expect(
      groupTasks(tasks, lists, false).map((g) => [g.list.href, g.tasks.map((t) => t.summary)])
    ).toEqual([
      ['/a/', ['a1']],
      ['/b/', ['b2']]
    ])
    expect(groupTasks(tasks, lists, true)[1].tasks.map((t) => t.summary)).toEqual(['b2', 'b1'])
  })

  it('detects overdue tasks', () => {
    const now = new Date(2026, 2, 10, 12)
    expect(isOverdue(task({ due: day(10) }), now)).toBe(false)
    expect(isOverdue(task({ due: day(9) }), now)).toBe(true)
    expect(isOverdue(task({ due: day(10, 11), allDay: false }), now)).toBe(true)
    expect(isOverdue(task({ due: day(9), status: 'COMPLETED' }), now)).toBe(false)
  })
})

describe('useTasks', () => {
  it('loads the tasks of all lists and keeps a failed list', async () => {
    const { tasks, loadTasks } = setup()
    api.fetchTasks.mockResolvedValueOnce([task({ calendarHref: '/a/', summary: 'a' })])
    api.fetchTasks.mockResolvedValueOnce([task({ calendarHref: '/b/', summary: 'b' })])
    await loadTasks([list('/a/'), list('/b/')])
    expect(tasks.value.map((t) => t.summary)).toEqual(['a', 'b'])

    api.fetchTasks.mockResolvedValueOnce([])
    api.fetchTasks.mockRejectedValueOnce(new Error('offline'))
    await loadTasks([list('/a/'), list('/b/')])
    expect(tasks.value.map((t) => t.summary)).toEqual(['b'])
    expect(messageStore.messages).toEqual([
      expect.objectContaining({ title: 'Failed to load tasks', desc: 'offline' })
    ])
  })

  it('creates, updates, completes and deletes tasks', async () => {
    const { tasks, loadTasks, createTask, updateTask, setCompleted, deleteTask } = setup()
    api.fetchTasks.mockResolvedValue([])
    await loadTasks([list('/a/')])

    const created = task({ href: '/a/1.ics', summary: 'new' })
    api.createTask.mockResolvedValue(created)
    expect(await createTask({ summary: 'new' } as TaskFormData)).toBe(created)
    expect(tasks.value).toEqual([created])

    const updated = { ...created, summary: 'changed' }
    api.updateTask.mockResolvedValue(updated)
    await updateTask(created, { summary: 'changed' } as TaskFormData)
    expect(tasks.value).toEqual([updated])

    const completed = { ...updated, status: 'COMPLETED' as const }
    api.setTaskCompleted.mockResolvedValue(completed)
    expect(await setCompleted(updated, true)).toBe(true)
    expect(api.setTaskCompleted).toHaveBeenCalledWith(updated, true)
    expect(tasks.value[0].status).toBe('COMPLETED')

    api.deleteTask.mockResolvedValue(undefined)
    expect(await deleteTask(completed)).toBe(true)
    expect(tasks.value).toEqual([])
  })

  it('reports failures and keeps the state', async () => {
    const { tasks, loadTasks, setCompleted, createTask } = setup()
    const existing = task({ href: '/a/1.ics' })
    api.fetchTasks.mockResolvedValue([existing])
    await loadTasks([list('/a/')])

    api.setTaskCompleted.mockRejectedValue(new Error('nope'))
    expect(await setCompleted(existing, true)).toBe(false)
    api.createTask.mockRejectedValue(new Error('nope'))
    expect(await createTask({} as TaskFormData)).toBeNull()

    expect(tasks.value).toEqual([existing])
    expect(messageStore.messages.map((m) => m.title)).toEqual([
      'Failed to update the task',
      'Failed to create the task'
    ])
  })
})
