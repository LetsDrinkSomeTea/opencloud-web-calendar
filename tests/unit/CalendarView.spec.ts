import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import listPlugin from '@fullcalendar/list'
import type { CalendarOptions } from '@fullcalendar/core'
import CalendarView from '../../src/components/CalendarView.vue'
import type { CalendarEvent } from '../../src/types/calendar'
import { globalMountOptions } from './helpers/design-system'

const { FullCalendarStub } = vi.hoisted(() => ({ FullCalendarStub: {} as any }))
vi.mock('@fullcalendar/vue3', async () => {
  const { defineComponent, h } = await import('vue')
  Object.assign(
    FullCalendarStub,
    defineComponent({
      name: 'FullCalendar',
      props: { options: { type: Object, required: true } },
      setup: () => () => h('div')
    })
  )
  return { default: FullCalendarStub }
})

function mountView(viewType = 'listAgenda') {
  const { global } = globalMountOptions()
  return mount(CalendarView, {
    props: {
      events: [] as CalendarEvent[],
      calendars: [],
      currentDate: new Date(2026, 9, 26),
      viewType: viewType as any
    },
    global
  })
}

function options(wrapper: ReturnType<typeof mountView>): CalendarOptions {
  return wrapper.findComponent(FullCalendarStub).props('options') as CalendarOptions
}

describe('CalendarView.vue', () => {
  it('registers the list plugin and a 30 day agenda view', () => {
    const opts = options(mountView())
    expect(opts.plugins).toContain(listPlugin)
    expect(opts.views?.listAgenda).toEqual({
      type: 'list',
      duration: { days: 30 },
      displayEventTime: true
    })
    expect(opts.initialView).toBe('listAgenda')
  })

  it('keeps the grid views', () => {
    expect(options(mountView('timeGridWeek')).initialView).toBe('timeGridWeek')
  })
})
