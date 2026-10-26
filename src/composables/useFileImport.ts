import { useClientService } from '@opencloud-eu/web-pkg'
import type { SpaceResource } from '@opencloud-eu/web-client'

/**
 * Downloads a file of the Files app by its id, for the "Import into calendar" action.
 *
 * `getFileContents` addresses a file given only by id as `/dav/spaces/<file id>`, so the space is
 * only consulted to rule out public link spaces (which need a path). The calendar runs in the user
 * context, so a minimal personal space stands in for the real one.
 */
export function useFileImport() {
  const clientService = useClientService()

  async function loadFile(fileId: string, name?: string): Promise<File> {
    const space = { id: fileId.split('!')[0], driveType: 'personal' } as unknown as SpaceResource
    const { body } = await clientService.webdav.getFileContents(
      space,
      { fileId },
      { responseType: 'text' }
    )
    const fileName = name?.trim() || 'calendar.ics'
    return new File([typeof body === 'string' ? body : String(body ?? '')], fileName, {
      type: 'text/calendar'
    })
  }

  return { loadFile }
}
