/** Turns a user given name (event summary, calendar name) into a safe file name without extension */
export function safeFileName(name: string, fallback: string): string {
  const safe = name.replace(/[^\p{L}\p{N}_\- ]/gu, '_').trim()
  return safe || fallback
}

/** Lets the browser download `content` as `<baseName>.ics` */
export function downloadICS(content: string, baseName: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFileName(baseName, 'calendar')}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
