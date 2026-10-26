import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CalendarToolbar from '../../src/components/CalendarToolbar.vue'
import CalendarSidebar from '../../src/components/CalendarSidebar.vue'
import type { Calendar } from '../../src/types/calendar'
import { globalMountOptions } from './helpers/design-system'

describe('CalendarToolbar.vue', () => {
  function mountToolbar(language = 'en') {
    const { global } = globalMountOptions(language)
    return mount(CalendarToolbar, {
      props: { currentDate: new Date(2026, 9, 26), viewType: 'timeGridWeek', sidebarOpen: false },
      global
    })
  }

  it('labels the icon-only buttons', () => {
    const wrapper = mountToolbar('de')
    const labels = wrapper.findAll('button[aria-label]').map((b) => b.attributes('aria-label'))
    expect(labels).toEqual(['Seitenleiste ein-/ausblenden', 'Zurück', 'Weiter'])
    expect(wrapper.find('button[aria-controls="web-calendar-sidebar"]').attributes()).toMatchObject(
      { 'aria-expanded': 'false' }
    )
  })

  it('marks the current view as pressed and emits view changes', async () => {
    const wrapper = mountToolbar()
    const views = wrapper.findAll('[role="group"] button')
    expect(views.map((b) => [b.text(), b.attributes('aria-pressed')])).toEqual([
      ['Month', 'false'],
      ['Week', 'true'],
      ['Day', 'false']
    ])

    await views[0].trigger('click')
    expect(wrapper.emitted('change-view')).toEqual([['dayGridMonth']])
  })

  it('emits navigation events', async () => {
    const wrapper = mountToolbar()
    await wrapper.find('button[aria-label="Previous"]').trigger('click')
    await wrapper.find('button[aria-label="Next"]').trigger('click')
    await wrapper.find('button[aria-label="Toggle sidebar"]').trigger('click')
    const today = wrapper.findAll('button').find((b) => b.text() === 'Today')
    await today.trigger('click')

    expect(Object.keys(wrapper.emitted())).toEqual(
      expect.arrayContaining(['prev', 'next', 'toggle-sidebar', 'today'])
    )
  })
})

describe('CalendarSidebar.vue', () => {
  const calendars: Calendar[] = [
    { href: '/cal/work/', displayName: 'Work', color: '#ef4444', ctag: '', visible: true },
    {
      href: '/cal/shared/',
      displayName: 'Shared',
      color: '#22c55e',
      ctag: '',
      visible: false,
      isShared: true,
      owner: 'alice'
    }
  ]

  function mountSidebar() {
    const { global } = globalMountOptions()
    return mount(CalendarSidebar, {
      props: { calendars, loading: false, isOpen: false },
      global
    })
  }

  it('toggles calendar visibility via labelled checkboxes', async () => {
    const wrapper = mountSidebar()
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes.map((c) => (c.element as HTMLInputElement).checked)).toEqual([true, false])
    expect(checkboxes[0].attributes('aria-label')).toBe('Work')
    expect(wrapper.find(`label[for="${checkboxes[0].attributes('id')}"]`).text()).toBe('Work')

    await checkboxes[1].setValue(true)
    expect(wrapper.emitted('toggle')).toEqual([['/cal/shared/']])
  })

  it('labels the actions', async () => {
    const wrapper = mountSidebar()
    const labels = wrapper.findAll('button[aria-label]').map((b) => b.attributes('aria-label'))
    expect(labels).toEqual([
      'Refresh',
      'Import calendar',
      'Create new calendar',
      'Share calendar',
      'Delete calendar',
      'Leave calendar'
    ])

    await wrapper.find('button[aria-label="Leave calendar"]').trigger('click')
    expect(wrapper.emitted('delete')).toEqual([['/cal/shared/']])
  })
})
