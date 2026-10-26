import { ref, readonly } from 'vue'
import { useGettext } from 'vue3-gettext'
import { getCalDAVClient } from '../caldav/client'
import {
  readICSFile,
  parseICSFile,
  fetchExistingEventMeta,
  generateImportPlan,
  executeImportPlan,
  buildImportReport,
  type ImportReport
} from '../caldav/ics-import'
import type { Calendar } from '../types/calendar'
import { translateError } from '../utils/error-message'

export type ImportMode = 'new-calendar' | 'merge'
export type ImportPhase =
  | 'idle'
  | 'reading'
  | 'parsing'
  | 'analyzing'
  | 'importing'
  | 'done'
  | 'error'

const isOpen = ref(false)
const phase = ref<ImportPhase>('idle')
const progress = ref({ current: 0, total: 0 })
const report = ref<ImportReport | null>(null)
const error = ref<string | null>(null)
/** File handed over by the Files app ("Import into calendar"), preselected in the dialog */
const initialFile = ref<File | null>(null)

export function useICSImport() {
  const { $gettext } = useGettext()
  const client = getCalDAVClient()

  function open(file: File | null = null) {
    initialFile.value = file
    phase.value = 'idle'
    progress.value = { current: 0, total: 0 }
    report.value = null
    error.value = null
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
    initialFile.value = null
    phase.value = 'idle'
    report.value = null
    error.value = null
  }

  async function importFile(
    file: File,
    mode: ImportMode,
    calendarName: string,
    targetCalendar: Calendar | null,
    calendarHomeUrl: string,
    existingCalendars: readonly Calendar[]
  ): Promise<ImportReport | null> {
    error.value = null
    report.value = null

    try {
      // Stage 1: Read file
      phase.value = 'reading'
      const icsText = await readICSFile(file)

      // Stage 2-5: Parse, validate, group
      phase.value = 'parsing'
      const { groups, errors: parseErrors } = parseICSFile(icsText)

      if (groups.length === 0) {
        error.value =
          parseErrors.length > 0
            ? parseErrors.join('\n')
            : $gettext('No valid events found in file')
        phase.value = 'error'
        return null
      }

      let calendarHref: string
      let displayName: string

      if (mode === 'new-calendar') {
        // Check for name conflicts client-side
        const nameExists = existingCalendars.some(
          (c) => c.displayName.toLowerCase() === calendarName.trim().toLowerCase()
        )
        if (nameExists) {
          error.value = $gettext(
            'Calendar "%{name}" already exists. Please choose a different name.',
            { name: calendarName }
          )
          phase.value = 'error'
          return null
        }

        // Create calendar
        phase.value = 'analyzing'
        const newCal = await client.createCalendar(calendarHomeUrl, {
          displayName: calendarName.trim()
        })
        calendarHref = newCal.href
        displayName = calendarName.trim()
      } else {
        if (!targetCalendar) {
          error.value = $gettext('No target calendar selected')
          phase.value = 'error'
          return null
        }
        calendarHref = targetCalendar.href
        displayName = targetCalendar.displayName
      }

      // Stage 6: Duplicate detection (merge only)
      phase.value = 'analyzing'
      const existing = mode === 'merge' ? await fetchExistingEventMeta(calendarHref) : null

      // Stage 7: Generate plan
      const actions = generateImportPlan(groups, existing, mode)

      // Stage 8: Execute
      phase.value = 'importing'
      const results = await executeImportPlan(actions, calendarHref, (current, total) => {
        progress.value = { current, total }
      })

      // Stage 9: Report
      const importReport = buildImportReport(mode, displayName, groups.length, results, parseErrors)
      report.value = importReport
      phase.value = 'done'
      return importReport
    } catch (e) {
      error.value = translateError(e, $gettext)
      phase.value = 'error'
      return null
    }
  }

  return {
    isOpen: readonly(isOpen),
    phase: readonly(phase),
    progress: readonly(progress),
    report: readonly(report),
    error: readonly(error),
    initialFile: readonly(initialFile),
    open,
    close,
    importFile
  }
}
