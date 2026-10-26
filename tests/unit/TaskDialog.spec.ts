import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import TaskDialog from '../../src/components/TaskDialog.vue'
import { globalMountOptions } from './helpers/design-system'
import type { Calendar } from '../../src/types/calendar'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const createTask = vi.fn()
const updateTask = vi.fn()

vi.mock('../../src/composables/useTasks', () => ({
  useTasks: () => ({ createTask, updateTask })
}))

const lists: Calendar[] = [
  { href: '/a/', displayName: 'Tasks', color: '#000', ctag: '', visible: true }
]

function mountDialog() {
  const { global } = globalMountOptions()
  return mount(TaskDialog, {
    props: { modal: { id: 'task', title: 'New Task' }, task: null, taskLists: lists },
    attachTo: '#app',
    global
  })
}

function input(selector: string, value: string) {
  const el = document.querySelector(selector) as HTMLInputElement
  el.value = value
  el.dispatchEvent(new Event('input'))
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  createTask.mockReset()
  updateTask.mockReset()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TaskDialog.vue', () => {
  it('requires a title and a start before the due date', async () => {
    const wrapper = mountDialog()
    expect(wrapper.emitted('update:confirmDisabled')).toEqual([[true]])

    input('#task-title', 'Buy milk')
    await nextTick()
    expect(wrapper.emitted('update:confirmDisabled').at(-1)).toEqual([false])

    input('#task-start-date', '2026-03-10')
    input('#task-due-date', '2026-03-09')
    await nextTick()
    expect(wrapper.emitted('update:confirmDisabled').at(-1)).toEqual([true])
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('due date')
  })

  it('creates the task on confirm', async () => {
    const created = { href: '/a/1.ics' }
    createTask.mockResolvedValue(created)
    const wrapper = mountDialog()
    input('#task-title', ' Buy milk ')
    input('#task-due-date', '2026-03-09')
    input('#task-categories', 'Home, Shopping,')
    await nextTick()

    await (wrapper.vm as unknown as { onConfirm: () => Promise<void> }).onConfirm()
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarHref: '/a/',
        summary: 'Buy milk',
        allDay: true,
        due: new Date(2026, 2, 9),
        start: null,
        categories: ['Home', 'Shopping']
      })
    )
    expect(wrapper.emitted('saved')).toEqual([[created]])
  })

  it('keeps the modal open when saving fails', async () => {
    createTask.mockResolvedValue(null)
    const wrapper = mountDialog()
    input('#task-title', 'x')
    await nextTick()
    await expect(
      (wrapper.vm as unknown as { onConfirm: () => Promise<void> }).onConfirm()
    ).rejects.toBeUndefined()
  })
})
