import { describe, it, expect, vi } from 'vitest'
import { isRef } from 'vue'
import type {
  ActionExtension,
  AppMenuItemExtension,
  ApplicationSetupOptions,
  FileActionOptions
} from '@opencloud-eu/web-pkg'
import type { Resource } from '@opencloud-eu/web-client'

const { authStore } = vi.hoisted(() => ({ authStore: { userContextReady: true } }))

vi.mock('@opencloud-eu/web-pkg', () => ({
  // defineWebApplication is a typed identity helper, so passing the definition through is enough
  defineWebApplication: (app: unknown) => app,
  useAuthStore: () => authStore
}))

vi.mock('@opencloud-eu/extension-sdk/tailwind.css', () => ({}))

// The app setup runs outside of a component, so gettext is mocked with an identity translator
vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (msgid: string) => msgid })
}))

vi.mock('../../src/views/Calendar.vue', () => ({
  default: { name: 'CalendarViewStub' }
}))

import app from '../../src/index'

function setupApp() {
  const definition = app as unknown as {
    setup: (args: ApplicationSetupOptions) => {
      appInfo: { id: string; name: string; icon: string; color: string }
      routes: Array<{
        path: string
        name: string
        component: () => Promise<{ default: unknown }>
        meta: Record<string, unknown>
      }>
      extensions: { value: [AppMenuItemExtension, ActionExtension] }
      translations: Record<string, Record<string, string>>
    }
  }
  return definition.setup({} as ApplicationSetupOptions)
}

describe('web-calendar app definition', () => {
  it('exposes the app info', () => {
    const { appInfo } = setupApp()
    expect(appInfo).toEqual({
      id: 'web-calendar',
      name: 'Web Calendar',
      icon: 'calendar',
      color: '#3788d8'
    })
  })

  it('registers a single authenticated root route', async () => {
    const { routes } = setupApp()
    expect(routes).toHaveLength(1)

    const [route] = routes
    expect(route.path).toBe('/')
    expect(route.name).toBe('web-calendar')
    expect(route.meta).toEqual({ authContext: 'user', title: 'Web Calendar' })

    const component = await route.component()
    expect(component.default).toEqual({ name: 'CalendarViewStub' })
  })

  it('provides an app menu item extension', () => {
    const { extensions, appInfo } = setupApp()
    expect(isRef(extensions)).toBe(true)
    expect(extensions.value).toHaveLength(2)

    const [menuItem] = extensions.value
    expect(menuItem).toMatchObject({
      id: 'app.web-calendar.menuItem',
      type: 'appMenuItem',
      color: '#3788d8',
      icon: 'calendar'
    })
    expect(menuItem.path).toMatch(/^\/?web-calendar$/)
    expect(typeof menuItem.label).toBe('function')
    expect((menuItem.label as () => string)()).toBe(appInfo.name)
  })

  it('ships the compiled translations', () => {
    const { translations } = setupApp()
    expect(translations.de['Web Calendar']).toBe('Web-Kalender')
  })
})

describe('"Import into calendar" action for the Files app', () => {
  function resource(data: Partial<Resource> = {}): Resource {
    return {
      fileId: 'storage$space!file',
      name: 'holidays.ics',
      extension: 'ics',
      mimeType: 'text/calendar',
      isFolder: false,
      canDownload: () => true,
      ...data
    } as Resource
  }

  function getAction() {
    const { extensions } = setupApp()
    const extension = extensions.value[1]
    return { extension, action: extension.action }
  }

  const options = (...resources: Resource[]) =>
    ({ space: null, resources }) as unknown as FileActionOptions

  it('is registered as a context action of the Files app', () => {
    const { extension, action } = getAction()
    expect(extension).toMatchObject({
      id: 'com.github.letsdrinksometea.web-calendar.import-ics',
      type: 'action',
      extensionPointIds: ['global.files.context-actions']
    })
    expect(action.name).toBe('web-calendar-import-ics')
    expect(action.label()).toBe('Import into calendar')
    expect(action.icon).toBe('calendar-event')
  })

  it('links to the calendar with the file id and name in the query', () => {
    const { action } = getAction()
    expect(action.route(options(resource()))).toEqual({
      name: 'web-calendar',
      query: { importFile: 'storage$space!file', importName: 'holidays.ics' }
    })
  })

  it('is shown for single .ics files', () => {
    const { action } = getAction()
    expect(action.isVisible(options(resource()))).toBe(true)
    expect(action.isVisible(options(resource({ extension: 'ICS', mimeType: '' })))).toBe(true)
    expect(
      action.isVisible(
        options(resource({ extension: '', name: 'export', mimeType: 'text/calendar' }))
      )
    ).toBe(true)
  })

  it('is hidden for other files, folders, multiple files and without download permission', () => {
    const { action } = getAction()
    expect(
      action.isVisible(
        options(resource({ extension: 'txt', name: 'a.txt', mimeType: 'text/plain' }))
      )
    ).toBe(false)
    expect(action.isVisible(options(resource({ isFolder: true })))).toBe(false)
    expect(action.isVisible(options(resource(), resource()))).toBe(false)
    expect(action.isVisible(options())).toBe(false)
    expect(action.isVisible(options(resource({ canDownload: () => false })))).toBe(false)
    expect(action.isVisible(options(resource({ fileId: undefined })))).toBe(false)
  })

  it('is hidden without a logged in user (public links)', () => {
    const { action } = getAction()
    authStore.userContextReady = false
    try {
      expect(action.isVisible(options(resource()))).toBe(false)
    } finally {
      authStore.userContextReady = true
    }
  })
})
