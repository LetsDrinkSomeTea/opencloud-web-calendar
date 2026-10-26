export type TaskStatus = 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED'

/** PRIORITY 1–4 is high, 5 medium, 6–9 low and 0 (or missing) undefined (RFC 5545 3.8.1.9) */
export type TaskPriority = 'none' | 'high' | 'medium' | 'low'

export interface Task {
  uid: string
  calendarHref: string
  href: string
  etag: string
  summary: string
  description?: string
  /** DUE of the shown occurrence */
  due?: Date
  /** DTSTART of the shown occurrence */
  start?: Date
  /** DUE/DTSTART are dates without time */
  allDay: boolean
  /** Raw PRIORITY value (0–9) */
  priority: number
  status: TaskStatus
  percentComplete: number
  completed?: Date
  categories: string[]
  isRecurring: boolean
  /**
   * RECURRENCE-ID (ical.js string value) of the shown occurrence of a recurring task. Completing
   * the task completes this occurrence only.
   */
  occurrenceId?: string
  icsData: string
}

export interface TaskFormData {
  calendarHref: string
  summary: string
  description: string
  due: Date | null
  start: Date | null
  allDay: boolean
  priority: TaskPriority
  status: TaskStatus
  percentComplete: number
  categories: string[]
}
