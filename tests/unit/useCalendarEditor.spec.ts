import { describe, it, expect, vi, beforeEach } from 'vitest'
import { canEditCalendar, useCalendarEditor } from '../../src/composables/useCalendarEditor'
import { CalDAVError } from '../../src/caldav/errors'
import type { Calendar } from '../../src/types/calendar'

const { createCalendar, updateCalendar } = vi.hoisted(() => ({
  createCalendar: vi.fn(),
  updateCalendar: vi.fn()
}))

vi.mock('../../src/caldav/client', () => ({
  getCalDAVClient: () => ({ createCalendar, updateCalendar })
}))

const work: Calendar = {
  href: '/caldav/alice/work/',
  displayName: 'Work',
  description: 'Office',
  color: '#ef4444',
  ctag: '',
  visible: true
}

beforeEach(() => {
  createCalendar.mockReset()
  updateCalendar.mockReset()
  useCalendarEditor().close()
})

describe('useCalendarEditor', () => {
  it('creates a new calendar', async () => {
    const editor = useCalendarEditor()
    editor.open()
    expect(editor.editingCalendar.value).toBeNull()
    editor.formData.value.displayName = 'Home'

    await expect(editor.save('/caldav/alice/')).resolves.toBe(true)
    expect(createCalendar).toHaveBeenCalledWith('/caldav/alice/', {
      displayName: 'Home',
      description: '',
      color: '#3788d8'
    })
    expect(updateCalendar).not.toHaveBeenCalled()
    expect(editor.isOpen.value).toBe(false)
  })

  it('prefills the form when editing and saves via PROPPATCH', async () => {
    const editor = useCalendarEditor()
    editor.open(work)
    expect(editor.editingCalendar.value).toEqual(work)
    expect(editor.formData.value).toEqual({
      displayName: 'Work',
      description: 'Office',
      color: '#ef4444'
    })

    editor.formData.value.displayName = ' Büro '
    editor.formData.value.description = ''
    editor.formData.value.color = '#22c55e'
    await expect(editor.save('/caldav/alice/')).resolves.toBe(true)

    expect(updateCalendar).toHaveBeenCalledWith('/caldav/alice/work/', {
      displayName: 'Büro',
      description: '',
      color: '#22c55e'
    })
    expect(createCalendar).not.toHaveBeenCalled()
    expect(editor.editingCalendar.value).toBeNull()
  })

  it('keeps the dialog open and exposes the error when saving fails', async () => {
    updateCalendar.mockRejectedValue(new CalDAVError('Forbidden', 403))
    const editor = useCalendarEditor()
    editor.open(work)

    await expect(editor.save('/caldav/alice/')).resolves.toBe(false)
    expect(editor.isOpen.value).toBe(true)
    expect(editor.error.value).toBeInstanceOf(CalDAVError)
  })
})

describe('canEditCalendar', () => {
  it('allows editing own writable calendars only', () => {
    expect(canEditCalendar(work)).toBe(true)
    expect(canEditCalendar({ ...work, readOnly: true })).toBe(false)
    expect(canEditCalendar({ ...work, isShared: true })).toBe(false)
    expect(canEditCalendar({ ...work, isShared: true, readOnly: false })).toBe(false)
  })
})
