import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { OcSelect } from '@opencloud-eu/design-system/components'
import EventReminders from '../../src/components/EventReminders.vue'
import EventAttendees from '../../src/components/EventAttendees.vue'
import { useReminders } from '../../src/composables/useReminders'
import { describeAlarm } from '../../src/utils/alarm-label'
import type { CalendarEvent, EventAlarm, EventAttendee } from '../../src/types/calendar'
import { createTestGettext, findButton, globalMountOptions } from './helpers/design-system'
import { graphUsers, messageStore, resetStores, userStore } from './helpers/web-pkg'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

beforeEach(() => {
  resetStores()
  document.body.innerHTML = '<div id="app"></div>'
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('describeAlarm', () => {
  const translate = createTestGettext('en')
  const t = { $gettext: translate.$gettext, $ngettext: translate.$ngettext }
  const display = (offset: number, related: 'START' | 'END' = 'START'): EventAlarm => ({
    action: 'DISPLAY',
    offset,
    related
  })

  it('describes relative alarms of timed events', () => {
    expect(describeAlarm(display(0), false, t)).toBe('At start of event')
    expect(describeAlarm(display(-900), false, t)).toBe('15 minutes before')
    expect(describeAlarm(display(-3600), false, t)).toBe('1 hour before')
    expect(describeAlarm(display(-86400), false, t)).toBe('1 day before')
    expect(describeAlarm(display(-604800), false, t)).toBe('1 week before')
    expect(describeAlarm(display(-300, 'END'), false, t)).toBe('5 minutes before the end')
    expect(describeAlarm({ action: 'EMAIL', offset: -3600 }, false, t)).toBe(
      '1 hour before (email)'
    )
  })

  it('describes alarms of all-day events with the time of day', () => {
    expect(describeAlarm(display(9 * 3600), true, t)).toBe('On the day at 09:00')
    expect(describeAlarm(display(9 * 3600 - 86400), true, t)).toBe('1 day before at 09:00')
    expect(describeAlarm(display(-2 * 86400), true, t)).toBe('2 days before at 00:00')
  })

  it('translates the descriptions', () => {
    const de = createTestGettext('de')
    expect(describeAlarm(display(-900), false, de)).toBe('15 Minuten vorher')
    expect(describeAlarm(display(9 * 3600), true, de)).toBe('Am Tag um 09:00')
  })
})

describe('EventReminders.vue', () => {
  function mountReminders(alarms: EventAlarm[], allDay = false) {
    const { global } = globalMountOptions('en')
    return mount(EventReminders, {
      props: { modelValue: alarms, allDay },
      attachTo: '#app',
      global
    })
  }

  it('lists the reminders and removes one', async () => {
    const wrapper = mountReminders([
      { action: 'DISPLAY', offset: -900, related: 'START' },
      { action: 'EMAIL', offset: -3600, related: 'START', raw: ['valarm', [], []] }
    ])
    expect(wrapper.text()).toContain('15 minutes before')
    expect(wrapper.text()).toContain('1 hour before (email)')

    await wrapper.find('button[aria-label="Remove reminder 15 minutes before"]').trigger('click')
    const [[alarms]] = wrapper.emitted('update:modelValue') as EventAlarm[][][]
    expect(alarms).toHaveLength(1)
    expect(alarms[0].action).toBe('EMAIL')
  })

  it('adds a preset once', async () => {
    const wrapper = mountReminders([{ action: 'DISPLAY', offset: -900, related: 'START' }])
    const select = wrapper.findComponent(OcSelect)
    const options = select.vm.$attrs.options as { value: string; label: string }[]
    expect(options.map((o) => o.label)).toEqual([
      'At start of event',
      '5 minutes before',
      '10 minutes before',
      '15 minutes before',
      '30 minutes before',
      '1 hour before',
      '1 day before',
      '1 week before',
      'Custom…'
    ])

    select.vm.$emit('update:modelValue', String(-3600))
    select.vm.$emit('update:modelValue', String(-900))
    const emitted = wrapper.emitted('update:modelValue') as EventAlarm[][][]
    expect(emitted).toHaveLength(1)
    expect(emitted[0][0][1]).toEqual({ action: 'DISPLAY', offset: -3600, related: 'START' })
  })

  it('offers all-day presets', () => {
    const wrapper = mountReminders([], true)
    const options = wrapper.findComponent(OcSelect).vm.$attrs.options as { label: string }[]
    expect(options.map((o) => o.label)).toEqual([
      'On the day at 09:00',
      '1 day before at 09:00',
      'Custom…'
    ])
  })

  it('adds a custom reminder', async () => {
    const wrapper = mountReminders([])
    wrapper.findComponent(OcSelect).vm.$emit('update:modelValue', 'custom')
    await nextTick()
    const amount = wrapper.find('input[type="number"]')
    await amount.setValue('2')
    const unit = wrapper.findAllComponents(OcSelect)[1]
    unit.vm.$emit('update:modelValue', 'hours')
    await nextTick()
    await findButton('Add').click()
    const emitted = wrapper.emitted('update:modelValue') as EventAlarm[][][]
    expect(emitted[0][0]).toEqual([{ action: 'DISPLAY', offset: -7200, related: 'START' }])
  })

  it('asks for the notification permission only on click', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
    vi.stubGlobal(
      'Notification',
      Object.assign(vi.fn(), { permission: 'default', requestPermission })
    )
    try {
      mountReminders([{ action: 'DISPLAY', offset: -900, related: 'START' }])
      expect(requestPermission).not.toHaveBeenCalled()
      findButton('Enable browser notifications').click()
      await nextTick()
      expect(requestPermission).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('EventAttendees.vue', () => {
  const bob: EventAttendee = {
    email: 'bob@example.org',
    name: 'Bob',
    partstat: 'NEEDS-ACTION',
    role: 'REQ-PARTICIPANT',
    rsvp: true
  }

  function mountAttendees(props: Record<string, unknown>) {
    const { global } = globalMountOptions('en')
    return mount(EventAttendees, { props: { attendees: [], ...props }, attachTo: '#app', global })
  }

  it('shows attendees with their participation status and the invitation hint', () => {
    const wrapper = mountAttendees({
      attendees: [bob, { ...bob, email: 'carol@example.org', name: '', partstat: 'ACCEPTED' }],
      organizer: { email: 'alice@example.org', name: 'Alice' }
    })
    expect(wrapper.text()).toContain('Bob')
    expect(wrapper.text()).toContain('Awaiting response')
    expect(wrapper.text()).toContain('carol@example.org')
    expect(wrapper.text()).toContain('Accepted')
    expect(wrapper.text()).toContain('Organizer: Alice')
    expect(wrapper.text()).toContain('Invitations are not sent by the calendar')
  })

  it('adds an attendee by email and sets the current user as organizer', async () => {
    userStore.user = { id: 'me', mail: 'me@example.org', displayName: 'Me' }
    const wrapper = mountAttendees({})
    await wrapper.find('input').setValue('dave@example.org')
    await findButton('Add').click()

    expect(wrapper.emitted('update:organizer')).toEqual([[{ email: 'me@example.org', name: 'Me' }]])
    expect(wrapper.emitted('update:attendees')).toEqual([
      [
        [
          {
            email: 'dave@example.org',
            partstat: 'NEEDS-ACTION',
            role: 'REQ-PARTICIPANT',
            rsvp: true,
            cutype: 'INDIVIDUAL'
          }
        ]
      ]
    ])
  })

  it('adds the typed address on enter without submitting the form', async () => {
    const wrapper = mountAttendees({})
    const input = wrapper.find('input')
    await input.setValue('frank@example.org')
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    input.element.dispatchEvent(event)
    await nextTick()
    expect(event.defaultPrevented).toBe(true)
    const [[attendees]] = wrapper.emitted('update:attendees') as EventAttendee[][][]
    expect(attendees[0].email).toBe('frank@example.org')
  })

  it('suggests OpenCloud users', async () => {
    vi.useFakeTimers()
    graphUsers.listUsers.mockResolvedValue([
      { id: '1', displayName: 'Erin', mail: 'erin@example.org' },
      { id: '2', displayName: 'No mail' }
    ])
    const wrapper = mountAttendees({})
    await wrapper.find('input').setValue('eri')
    await vi.advanceTimersByTimeAsync(300)
    expect(graphUsers.listUsers).toHaveBeenCalledWith(expect.objectContaining({ search: '"eri"' }))
    const suggestion = wrapper.findAll('[role="option"] button')
    expect(suggestion).toHaveLength(1)
    await suggestion[0].trigger('click')
    const [[attendees]] = wrapper.emitted('update:attendees') as EventAttendee[][][]
    expect(attendees[0]).toMatchObject({ email: 'erin@example.org', name: 'Erin' })
  })

  it('lets an invited user respond but not change the attendees', async () => {
    userStore.user = { id: 'bob', mail: 'BOB@example.org' }
    const wrapper = mountAttendees({
      attendees: [bob],
      organizer: { email: 'alice@example.org' }
    })
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Remove attendee"]').exists()).toBe(false)

    await findButton('Accept').click()
    const [[attendees]] = wrapper.emitted('update:attendees') as EventAttendee[][][]
    expect(attendees[0].partstat).toBe('ACCEPTED')
  })

  it('removes the organizer together with the last attendee', async () => {
    userStore.user = { id: 'me', mail: 'me@example.org' }
    const wrapper = mountAttendees({ attendees: [bob], organizer: { email: 'me@example.org' } })
    expect(findButton('Accept')).toBeUndefined()
    await wrapper.find('button[aria-label="Remove attendee Bob"]').trigger('click')
    expect(wrapper.emitted('update:attendees')).toEqual([[[]]])
    expect(wrapper.emitted('update:organizer')).toEqual([[undefined]])
  })
})

describe('useReminders', () => {
  function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return {
      uid: 'uid',
      calendarHref: '/caldav/cal/',
      href: '/caldav/cal/uid.ics',
      etag: 'e',
      summary: 'Review',
      start: new Date('2026-10-26T09:00:00Z'),
      end: new Date('2026-10-26T10:00:00Z'),
      allDay: false,
      icsData: '',
      isRecurring: false,
      alarms: [{ action: 'DISPLAY', offset: -600, related: 'START' }],
      ...overrides
    }
  }

  function mountComposable(events: ReturnType<typeof ref<CalendarEvent[]>>) {
    return mount(
      defineComponent({
        setup() {
          useReminders(() => events.value ?? [])
          return () => h('div')
        }
      }),
      { global: { plugins: [createTestGettext('en')] } }
    )
  }

  it('shows a message and a browser notification when an alarm fires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T08:00:00Z'))
    const NotificationMock = Object.assign(vi.fn(), { permission: 'granted' })
    vi.stubGlobal('Notification', NotificationMock)
    try {
      const events = ref<CalendarEvent[]>([event({ href: '/caldav/cal/fire.ics' })])
      mountComposable(events)
      await vi.advanceTimersByTimeAsync(50 * 60 * 1000)

      expect(messageStore.messages).toHaveLength(1)
      expect(messageStore.messages[0]).toMatchObject({ title: 'Reminder: Review' })
      expect(NotificationMock).toHaveBeenCalledWith(
        'Reminder: Review',
        expect.objectContaining({ body: expect.any(String) })
      )

      // reloading the same events does not show it again
      events.value = [event({ href: '/caldav/cal/fire.ics' })]
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(messageStore.messages).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('clears the timers on unmount', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T08:00:00Z'))
    const wrapper = mountComposable(ref([event({ href: '/caldav/cal/unmount.ics' })]))
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(messageStore.messages).toEqual([])
  })
})
