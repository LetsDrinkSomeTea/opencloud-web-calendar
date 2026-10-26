import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import ICSImportDialog from '../../src/components/ICSImportDialog.vue'
import InviteJoinDialog from '../../src/components/InviteJoinDialog.vue'
import type { ImportPhase } from '../../src/composables/useICSImport'
import type { Calendar } from '../../src/types/calendar'
import { findButton, globalMountOptions } from './helpers/design-system'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./helpers/web-pkg')).webPkgMock)

const phase = ref<ImportPhase>('idle')
const report = ref<unknown>(null)
const importError = ref<string | null>(null)
const importFile = vi.fn()

vi.mock('../../src/composables/useICSImport', () => ({
  useICSImport: () => ({
    phase,
    progress: ref({ current: 1, total: 4 }),
    report,
    error: importError,
    importFile
  })
}))

const calendars: Calendar[] = [
  { href: '/cal/work/', displayName: 'Work', color: '#ef4444', ctag: '', visible: true }
]

function mountDialog(language = 'en') {
  const { global } = globalMountOptions(language)
  return mount(ICSImportDialog, {
    props: {
      modal: { id: 'import', title: 'Import Calendar' },
      calendars,
      calendarHomeUrl: '/home/',
      defaultCalendar: calendars[0]
    },
    attachTo: '#app',
    global
  })
}

function selectFile(name = 'holidays.ics') {
  const input = document.querySelector('#web-calendar-import-file') as HTMLInputElement
  const file = new File(['BEGIN:VCALENDAR'], name, { type: 'text/calendar' })
  Object.defineProperty(input, 'files', { value: [file] })
  input.dispatchEvent(new Event('change'))
  return file
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="oc-modal-actions-import"></div>'
  phase.value = 'idle'
  report.value = null
  importError.value = null
  importFile.mockReset()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ICSImportDialog.vue', () => {
  it('enables the import once a file is selected and suggests a calendar name', async () => {
    mountDialog()
    await nextTick()
    expect(findButton('Import').disabled).toBe(true)

    selectFile()
    await nextTick()
    await nextTick()

    expect((document.querySelector('#import-cal-name') as HTMLInputElement).value).toBe('holidays')
    expect(findButton('Import').disabled).toBe(false)
  })

  it('imports the selected file and reports success', async () => {
    const wrapper = mountDialog()
    await nextTick()
    const file = selectFile()
    await nextTick()
    await nextTick()

    importFile.mockImplementation(async () => {
      phase.value = 'done'
    })
    document.querySelector('form').dispatchEvent(new Event('submit'))
    await nextTick()
    await nextTick()

    expect(importFile).toHaveBeenCalledWith(file, 'new-calendar', 'holidays', null, '/home/', [
      ...calendars
    ])
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })

  it('shows import errors inline', async () => {
    importError.value = 'No valid events found in file'
    mountDialog()
    await nextTick()
    expect(document.querySelector('[role="alert"]').textContent).toContain('No valid events')
  })

  it('shows the progress while importing', async () => {
    phase.value = 'importing'
    mountDialog()
    await nextTick()

    expect(document.querySelector('[role="progressbar"]')).not.toBeNull()
    expect(document.body.textContent).toContain('(1/4)')
    expect(findButton('Import')).toBeUndefined()
  })

  it('shows the report and a close button when done', async () => {
    phase.value = 'done'
    report.value = {
      mode: 'new-calendar',
      calendarName: 'Holidays',
      created: 2,
      updated: 0,
      skipped: 0,
      failed: 1,
      errors: [],
      results: [{ type: 'failed', summary: 'Broken', error: 'Bad DTSTART' }]
    }
    const wrapper = mountDialog('de')
    await nextTick()

    expect(document.body.textContent).toContain('„Holidays“')
    findButton('Details anzeigen').click()
    await nextTick()
    expect(document.querySelector('table').textContent).toContain('Fehlgeschlagen')

    findButton('Schließen').click()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})

describe('InviteJoinDialog.vue', () => {
  it('describes the invitation', () => {
    const { global } = globalMountOptions('de')
    const wrapper = mount(InviteJoinDialog, {
      props: {
        modal: { id: 'join', title: 'Join' },
        inviteData: { displayName: 'Team', color: '#22c55e', permissions: 'rw', owner: 'alice' }
      },
      global
    })
    expect(wrapper.text()).toContain('„Team“')
    expect(wrapper.text()).toContain('alice')
    expect(wrapper.text()).toContain('Lesen & Schreiben')
  })
})
