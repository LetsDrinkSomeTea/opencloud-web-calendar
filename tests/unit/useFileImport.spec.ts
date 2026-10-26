import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useFileImport } from '../../src/composables/useFileImport'
import { readICSFile } from '../../src/caldav/ics-import'

const { getFileContents } = vi.hoisted(() => ({ getFileContents: vi.fn() }))

vi.mock('@opencloud-eu/web-pkg', () => ({
  useClientService: () => ({ webdav: { getFileContents } })
}))

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'

beforeEach(() => {
  getFileContents.mockReset()
})

describe('useFileImport', () => {
  it('downloads the file by its id and wraps it into a File for the import', async () => {
    getFileContents.mockResolvedValue({ body: ICS })
    const file = await useFileImport().loadFile('storage$space!opaque', 'holidays.ics')

    const [space, resource, options] = getFileContents.mock.calls[0]
    expect(resource).toEqual({ fileId: 'storage$space!opaque' })
    expect(options).toEqual({ responseType: 'text' })
    // Not a public link space, so the id based DAV URL is used
    expect(space.driveType).not.toBe('public')

    expect(file.name).toBe('holidays.ics')
    expect(file.type).toBe('text/calendar')
    // The import dialog reads it like a file picked by the user
    await expect(readICSFile(file)).resolves.toBe(ICS)
  })

  it('falls back to a generic file name', async () => {
    getFileContents.mockResolvedValue({ body: ICS })
    const file = await useFileImport().loadFile('id')
    expect(file.name).toBe('calendar.ics')
  })

  it('propagates download errors', async () => {
    getFileContents.mockRejectedValue(new Error('404'))
    await expect(useFileImport().loadFile('id')).rejects.toThrow('404')
  })
})
