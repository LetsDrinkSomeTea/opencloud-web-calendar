import { describe, it, expect } from 'vitest'
import { getDefaultEventStart } from '../../src/utils/new-event'
import { isShortcutTarget } from '../../src/utils/shortcuts'

describe('getDefaultEventStart', () => {
  const now = new Date(2026, 9, 26, 14, 37)

  it.each([
    ['dayGridMonth', new Date(2026, 9, 1)],
    ['timeGridWeek', new Date(2026, 9, 26)],
    ['timeGridDay', new Date(2026, 9, 26)],
    ['listAgenda', new Date(2026, 9, 10)]
  ] as const)('uses the next full hour today when %s shows today', (view, viewDate) => {
    expect(getDefaultEventStart(view, viewDate, now)).toEqual(new Date(2026, 9, 26, 15))
  })

  it('rolls over to the next day late in the evening', () => {
    expect(
      getDefaultEventStart('timeGridDay', new Date(2026, 9, 26), new Date(2026, 9, 26, 23, 5))
    ).toEqual(new Date(2026, 9, 27, 0))
  })

  it.each([
    ['timeGridDay', new Date(2026, 10, 3), new Date(2026, 10, 3, 9)],
    ['timeGridWeek', new Date(2026, 10, 2), new Date(2026, 10, 2, 9)],
    ['dayGridMonth', new Date(2026, 11, 1), new Date(2026, 11, 1, 9)],
    ['listAgenda', new Date(2026, 8, 1), new Date(2026, 8, 1, 9)]
  ] as const)(
    'uses 9:00 on the first shown day when %s does not show today',
    (view, date, start) => {
      expect(getDefaultEventStart(view, date, now)).toEqual(start)
    }
  )
})

describe('isShortcutTarget', () => {
  it('ignores key presses while typing or inside dialogs', () => {
    document.body.innerHTML = `
      <input id="input" />
      <textarea id="textarea"></textarea>
      <div role="dialog"><button id="dialog-button"></button></div>
      <button id="button"></button>
    `
    const byId = (id: string) => document.getElementById(id)
    expect(isShortcutTarget(byId('input'))).toBe(false)
    expect(isShortcutTarget(byId('textarea'))).toBe(false)
    expect(isShortcutTarget(byId('dialog-button'))).toBe(false)
    expect(isShortcutTarget(byId('button'))).toBe(true)
    expect(isShortcutTarget(document.body)).toBe(true)
    expect(isShortcutTarget(null)).toBe(true)
  })
})
