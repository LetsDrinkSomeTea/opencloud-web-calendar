import { computed, type ComputedRef } from 'vue'
import { useGettext } from 'vue3-gettext'
import {
  useAuthStore,
  type ActionExtension,
  type AppMenuItemExtension,
  type Extension,
  type FileAction,
  type FileActionOptions
} from '@opencloud-eu/web-pkg'
import { urlJoin } from '@opencloud-eu/web-client'
import type { Resource } from '@opencloud-eu/web-client'

export const APP_ID = 'web-calendar'
export const APP_ROUTE_NAME = 'web-calendar'
export const ICS_FILE_EXTENSIONS = ['ics', 'ical', 'icalendar']
export const ICS_MIME_TYPE = 'text/calendar'
export const IMPORT_ACTION_EXTENSION_ID = 'com.github.letsdrinksometea.web-calendar.import-ics'

/** Whether a resource from the Files app is an iCalendar file */
export function isICSResource(resource: Pick<Resource, 'extension' | 'mimeType' | 'name'>) {
  const extension = (resource.extension || resource.name?.split('.').pop() || '').toLowerCase()
  if (ICS_FILE_EXTENSIONS.includes(extension)) return true
  return resource.mimeType?.toLowerCase().split(';')[0].trim() === ICS_MIME_TYPE
}

interface ImportActionOptions {
  $gettext: (msgid: string) => string
  /** Whether a user is logged in; the calendar needs the user context (no public links) */
  isUserContextReady: () => boolean
}

/**
 * "Import into calendar" action for `.ics` files in the Files app. It links to the calendar
 * with the file id in the query, Calendar.vue downloads the file and opens the import dialog.
 */
export function createImportICSAction({
  $gettext,
  isUserContextReady
}: ImportActionOptions): FileAction {
  return {
    name: 'web-calendar-import-ics',
    icon: 'calendar-event',
    label: () => $gettext('Import into calendar'),
    route: ({ resources }: FileActionOptions) => ({
      name: APP_ROUTE_NAME,
      query: { importFile: resources[0].fileId, importName: resources[0].name }
    }),
    isVisible: ({ resources }: FileActionOptions = { space: null }) => {
      if (!isUserContextReady()) return false
      if (resources?.length !== 1) return false
      const [resource] = resources
      if (resource.isFolder || !resource.fileId) return false
      if (typeof resource.canDownload === 'function' && !resource.canDownload()) return false
      return isICSResource(resource)
    },
    class: 'oc-files-actions-web-calendar-import-ics'
  }
}

export function useCalendarExtensions(appInfo: {
  id: string
  color: string
  icon: string
}): ComputedRef<Extension[]> {
  const { $gettext } = useGettext()
  const authStore = useAuthStore()

  return computed<Extension[]>(() => {
    const menuItem: AppMenuItemExtension = {
      id: `app.${appInfo.id}.menuItem`,
      type: 'appMenuItem',
      // Evaluated lazily so the label follows language changes
      label: () => $gettext('Web Calendar'),
      color: appInfo.color,
      icon: appInfo.icon,
      path: urlJoin(appInfo.id)
    }

    // Same pattern as the unzip app of opencloud-eu/web-extensions
    // (packages/web-app-unzip/src/composables/useExtensions.ts)
    const importAction: ActionExtension = {
      id: IMPORT_ACTION_EXTENSION_ID,
      type: 'action',
      extensionPointIds: ['global.files.context-actions'],
      action: createImportICSAction({
        $gettext,
        isUserContextReady: () => !!authStore.userContextReady
      })
    }

    return [menuItem, importAction]
  })
}
