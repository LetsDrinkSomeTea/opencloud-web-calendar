import { describe, it, expect, vi } from 'vitest'
import { isRef } from 'vue'
import type { AppMenuItemExtension, ApplicationSetupOptions } from '@opencloud-eu/web-pkg'

vi.mock('@opencloud-eu/web-pkg', () => ({
  // defineWebApplication is a typed identity helper, so passing the definition through is enough
  defineWebApplication: (app: unknown) => app,
  useUserStore: () => ({ user: { preferredLanguage: 'en' } })
}))

vi.mock('@opencloud-eu/extension-sdk/tailwind.css', () => ({}))

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
      extensions: { value: AppMenuItemExtension[] }
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
    expect(extensions.value).toHaveLength(1)

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
})
