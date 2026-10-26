import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import CalendarToolbar from '../../src/components/CalendarToolbar.vue'
import CalendarSidebar from '../../src/components/CalendarSidebar.vue'
import type { Calendar } from '../../src/types/calendar'
import { globalMountOptions as baseMountOptions } from './helpers/design-system'

/** `OcDrop` positions itself with floating-ui; the stub renders the menu inline */
function globalMountOptions(language = 'en') {
  const options = baseMountOptions(language)
  options.global.stubs = {
    ...options.global.stubs,
    OcDrop: { template: '<div class="oc-drop-stub"><slot /></div>' }
  } as typeof options.global.stubs
  return options
}

describe('CalendarToolbar.vue', () => {
  function mountToolbar(language = 'en', props: Record<string, unknown> = {}) {
    const { global } = globalMountOptions(language)
    return mount(CalendarToolbar, {
      props: {
        currentDate: new Date(2026, 9, 26),
        viewType: 'timeGridWeek',
        sidebarOpen: false,
        ...props
      },
      global,
      attachTo: document.body
    })
  }

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('labels the icon-only buttons', () => {
    const wrapper = mountToolbar('de')
    const labels = wrapper.findAll('button[aria-label]').map((b) => b.attributes('aria-label'))
    expect(labels).toEqual(
      expect.arrayContaining([
        'Seitenleiste ein-/ausblenden',
        'Zurück',
        'Weiter',
        'Termine durchsuchen',
        'Neuer Termin'
      ])
    )
    expect(wrapper.find('button[aria-controls="web-calendar-sidebar"]').attributes()).toMatchObject(
      { 'aria-expanded': 'false' }
    )
    expect(wrapper.find('input[type="search"]').attributes('aria-label')).toBe(
      'Termine durchsuchen'
    )
  })

  it('marks the current view as pressed and emits view changes', async () => {
    const wrapper = mountToolbar()
    const views = wrapper.findAll('[role="group"] button')
    expect(views.map((b) => [b.text(), b.attributes('aria-pressed')])).toEqual([
      ['Month', 'false'],
      ['Week', 'true'],
      ['Day', 'false'],
      ['Agenda', 'false']
    ])

    await views[0].trigger('click')
    await views[3].trigger('click')
    expect(wrapper.emitted('change-view')).toEqual([['dayGridMonth'], ['listAgenda']])
  })

  it('shows the date range of the agenda', () => {
    const wrapper = mountToolbar('en', { viewType: 'listAgenda' })
    const title = wrapper.find('h2').text()
    expect(title).toContain('Oct 26')
    expect(title).toContain('Nov 24')
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

  describe('new event button', () => {
    it('is a labelled primary button that emits new-event', async () => {
      const wrapper = mountToolbar()
      const button = wrapper.find('[data-testid="web-calendar-new-event"]')
      expect(button.attributes('aria-label')).toBe('New event')
      expect(button.text()).toBe('New event')
      expect(button.classes()).toContain('oc-button-filled')
      await button.trigger('click')
      expect(wrapper.emitted('new-event')).toEqual([[]])
    })

    it('is disabled without a calendar to create the event in', async () => {
      const wrapper = mountToolbar('en', { canCreate: false })
      const button = wrapper.find('[data-testid="web-calendar-new-event"]')
      expect(button.attributes()).toHaveProperty('disabled')
      await button.trigger('click')
      expect(wrapper.emitted('new-event')).toBeUndefined()
    })
  })

  describe('search', () => {
    it('debounces the typed query', async () => {
      vi.useFakeTimers()
      const wrapper = mountToolbar()
      const input = wrapper.find('input[type="search"]')
      await input.setValue('mül')
      await input.setValue('müller ')
      vi.advanceTimersByTime(299)
      expect(wrapper.emitted('search')).toBeUndefined()
      vi.advanceTimersByTime(1)
      expect(wrapper.emitted('search')).toEqual([['müller']])
    })

    it('searches immediately on Enter', async () => {
      vi.useFakeTimers()
      const wrapper = mountToolbar()
      const input = wrapper.find('input[type="search"]')
      await input.setValue('team')
      await input.trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('search')).toEqual([['team']])
      vi.runAllTimers()
      expect(wrapper.emitted('search')).toHaveLength(1)
    })

    it('shows the query from the route', async () => {
      const wrapper = mountToolbar('en', { searchQuery: 'café' })
      expect((wrapper.find('input[type="search"]').element as HTMLInputElement).value).toBe('café')
      await wrapper.setProps({ searchQuery: '' })
      expect((wrapper.find('input[type="search"]').element as HTMLInputElement).value).toBe('')
    })

    it('has a toggle for small screens that clears the search when closed', async () => {
      const wrapper = mountToolbar('en', { searchQuery: 'café' })
      const toggle = wrapper.find('button[aria-label="Close search"]')
      expect(toggle.attributes('aria-expanded')).toBe('true')
      await toggle.trigger('click')
      expect(wrapper.emitted('search')).toEqual([['']])
      expect(wrapper.find('button[aria-label="Search events"]').attributes('aria-expanded')).toBe(
        'false'
      )
    })
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
      'Actions for Work',
      'Actions for Shared'
    ])
  })

  function actionNames(wrapper: ReturnType<typeof mountSidebar>, index: number) {
    return wrapper
      .findAll('li.web-calendar-sidebar-item')
      [index].findAll('[class*="web-calendar-action-"]')
      .map((b) => /web-calendar-action-([a-z-]+)/.exec(b.classes().join(' '))[1])
  }

  it('offers edit, share, export, subscription URL and delete for own calendars', async () => {
    const wrapper = mountSidebar()
    expect(actionNames(wrapper, 0)).toEqual(['edit', 'share', 'export', 'copy-url', 'delete'])

    const item = wrapper.findAll('li.web-calendar-sidebar-item')[0]
    await item.find('.web-calendar-action-edit').trigger('click')
    await item.find('.web-calendar-action-export').trigger('click')
    await item.find('.web-calendar-action-copy-url').trigger('click')
    await item.find('.web-calendar-action-delete').trigger('click')
    expect(wrapper.emitted('edit')).toEqual([['/cal/work/']])
    expect(wrapper.emitted('export')).toEqual([['/cal/work/']])
    expect(wrapper.emitted('copyUrl')).toEqual([['/cal/work/']])
    expect(wrapper.emitted('delete')).toEqual([['/cal/work/']])
    expect(item.find('.web-calendar-action-copy-url').attributes('title')).toContain('app token')
  })

  it('does not allow editing or sharing calendars shared with the user', async () => {
    const wrapper = mountSidebar()
    expect(actionNames(wrapper, 1)).toEqual(['export', 'copy-url', 'delete'])
    const leave = wrapper
      .findAll('li.web-calendar-sidebar-item')[1]
      .find('.web-calendar-action-delete')
    expect(leave.text()).toBe('Leave calendar')
  })

  it('does not allow editing read-only calendars', async () => {
    const { global } = globalMountOptions()
    const wrapper = mount(CalendarSidebar, {
      props: {
        calendars: [{ ...calendars[0], readOnly: true }],
        loading: false,
        isOpen: false
      },
      global
    })
    expect(actionNames(wrapper, 0)).toEqual(['export', 'copy-url', 'delete'])
  })

  describe('off-canvas on small screens', () => {
    let wide = false
    beforeEach(() => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: wide,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn()
        }))
      )
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    function mountWith(isOpen: boolean) {
      const { global } = globalMountOptions()
      return mount(CalendarSidebar, { props: { calendars, loading: false, isOpen }, global })
    }

    it('is inert while closed on small screens', () => {
      wide = false
      expect(mountWith(false).find('aside').attributes()).toHaveProperty('inert')
    })

    it('is reachable while open on small screens', () => {
      wide = false
      expect(mountWith(true).find('aside').attributes()).not.toHaveProperty('inert')
    })

    it('is always reachable on wide screens', () => {
      wide = true
      expect(mountWith(false).find('aside').attributes()).not.toHaveProperty('inert')
    })
  })
})
