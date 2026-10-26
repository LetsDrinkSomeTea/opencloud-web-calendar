import { ref, readonly } from 'vue'
import { getCalDAVClient } from '../caldav/client'
import { findOverlappingPeriods, type BusyPeriod } from '../caldav/freebusy'

export interface FreeBusyCheck {
  calendarHrefs: string[]
  start: Date
  end: Date
  /**
   * Time of the event being edited. Its own busy period is not a conflict. Matching is by
   * exact start and end, the server does not say which event a period belongs to.
   */
  ignore?: { start: Date; end: Date } | null
}

/**
 * Padding around the checked time for the query. Servers may clip periods to the queried
 * range; with padding the period of the edited event itself is returned unclipped, so it can
 * be recognized and ignored.
 */
const QUERY_PADDING_MS = 24 * 60 * 60 * 1000

/**
 * Free/busy lookup for the event editor: which busy periods of the given calendars overlap a
 * proposed event time (`free-busy-query`, RFC 4791 7.10).
 */
export function useFreeBusy() {
  const client = getCalDAVClient()
  const conflicts = ref<BusyPeriod[]>([])
  const checking = ref(false)
  const error = ref<unknown>(null)
  // Only the result of the latest check is applied
  let latestCheck = 0

  async function check({ calendarHrefs, start, end, ignore }: FreeBusyCheck): Promise<void> {
    const id = ++latestCheck
    if (calendarHrefs.length === 0 || !(end.getTime() >= start.getTime())) {
      conflicts.value = []
      return
    }

    checking.value = true
    try {
      const periods = await client.queryFreeBusy(calendarHrefs, {
        start: new Date(start.getTime() - QUERY_PADDING_MS),
        end: new Date(end.getTime() + QUERY_PADDING_MS)
      })
      if (id !== latestCheck) return

      let ignored = false
      conflicts.value = findOverlappingPeriods(periods, start, end).filter((period) => {
        const isOwn =
          !ignored &&
          !!ignore &&
          period.start.getTime() === ignore.start.getTime() &&
          period.end.getTime() === ignore.end.getTime()
        if (isOwn) ignored = true
        return !isOwn
      })
      error.value = null
    } catch (err) {
      if (id !== latestCheck) return
      // The hint is optional, a failed lookup just shows no hint
      console.warn('Free/busy lookup failed:', err)
      conflicts.value = []
      error.value = err
    } finally {
      if (id === latestCheck) checking.value = false
    }
  }

  function clear(): void {
    latestCheck++
    conflicts.value = []
    checking.value = false
  }

  return {
    conflicts: readonly(conflicts),
    checking: readonly(checking),
    error: readonly(error),
    check,
    clear
  }
}
