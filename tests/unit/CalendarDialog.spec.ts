import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import CalendarDialog from '../../src/components/CalendarDialog.vue'
import { globalMountOptions } from './helpers/design-system'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const save = vi.fn()
const formData = ref({ displayName: '', description: '', color: '#3788d8' })
const error = ref<Error | null>(null)

vi.mock('../../src/composables/useCalendarEditor', () => ({
  useCalendarEditor: () => ({ formData, error, save })
}))

function mountDialog(language = 'en') {
  const { global } = globalMountOptions(language)
  return mount(CalendarDialog, {
    props: { modal: { id: 'calendar', title: 'New Calendar' }, calendarHomeUrl: '/home/' },
    attachTo: '#app',
    global
  })
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  formData.value = { displayName: '', description: '', color: '#3788d8' }
  error.value = null
  save.mockReset()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CalendarDialog.vue', () => {
  it('disables the modal confirm button until a name is entered', async () => {
    const wrapper = mountDialog()
    expect(wrapper.emitted('update:confirmDisabled')).toEqual([[true]])

    const input = document.querySelector('#calendar-name') as HTMLInputElement
    input.value = 'Work'
    input.dispatchEvent(new Event('input'))
    await nextTick()

    expect(formData.value.displayName).toBe('Work')
    expect(wrapper.emitted('update:confirmDisabled').at(-1)).toEqual([false])
  })

  it('creates the calendar on confirm', async () => {
    formData.value.displayName = 'Work'
    save.mockResolvedValue(true)
    const wrapper = mountDialog()

    await (wrapper.vm as unknown as { onConfirm: () => Promise<void> }).onConfirm()
    expect(save).toHaveBeenCalledWith('/home/')
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('keeps the modal open when creating fails', async () => {
    formData.value.displayName = 'Work'
    save.mockResolvedValue(false)
    const wrapper = mountDialog()

    await expect(
      (wrapper.vm as unknown as { onConfirm: () => Promise<void> }).onConfirm()
    ).rejects.toBeUndefined()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('submits via the modal wrapper on enter', async () => {
    formData.value.displayName = 'Work'
    const wrapper = mountDialog()

    document.querySelector('form').dispatchEvent(new Event('submit'))
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('offers labelled color swatches', async () => {
    mountDialog('de')
    await nextTick()

    const green = document.querySelector('[aria-label="Grün"]') as HTMLButtonElement
    expect(green).not.toBeNull()
    expect(green.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('[aria-label="Blau"]').getAttribute('aria-pressed')).toBe('true')

    green.click()
    await nextTick()
    expect(formData.value.color).toBe('#22c55e')
    expect(green.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows errors inline', async () => {
    error.value = new Error('Boom')
    mountDialog()
    await nextTick()
    expect(document.querySelector('[role="alert"]').textContent).toContain('Boom')
  })
})
