import { describe, it, expect, vi } from 'vitest'
import { isRef } from 'vue'
import type {
  AppMenuItemExtension,
  AppNavigationItem,
  ApplicationSetupOptions,
  GlobalProperties
} from '@opencloud-eu/web-pkg'

vi.mock('@opencloud-eu/web-pkg', () => ({
  // defineWebApplication is a typed identity helper, so passing the definition through is enough
  defineWebApplication: (app: unknown) => app
}))

vi.mock('@opencloud-eu/extension-sdk/tailwind.css', () => ({}))

// The app setup runs outside of a component, so gettext is mocked with an identity translator
vi.mock('vue3-gettext', () => ({
  useGettext: () => ({ $gettext: (msgid: string) => msgid })
}))

vi.mock('../../src/views/Calendar.vue', () => ({
  default: { name: 'CalendarViewStub' }
}))

vi.mock('../../src/views/Tasks.vue', () => ({
  default: { name: 'TasksViewStub' }
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
      navItems: (props: GlobalProperties) => AppNavigationItem[]
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

  it('registers the authenticated calendar and tasks routes', async () => {
    const { routes } = setupApp()
    expect(routes).toHaveLength(2)

    const [calendar, tasks] = routes
    expect(calendar.path).toBe('/')
    expect(calendar.name).toBe('web-calendar')
    expect(calendar.meta).toEqual({ authContext: 'user', title: 'Web Calendar' })
    expect((await calendar.component()).default).toEqual({ name: 'CalendarViewStub' })

    expect(tasks.path).toBe('/tasks')
    expect(tasks.name).toBe('tasks')
    expect(tasks.meta).toEqual({ authContext: 'user', title: 'Tasks' })
    expect((await tasks.component()).default).toEqual({ name: 'TasksViewStub' })
  })

  it('provides navigation items for calendar and tasks', () => {
    const { navItems } = setupApp()
    const currentRoute = { value: { name: 'web-calendar' as string } }
    const items = navItems({ $router: { currentRoute } } as unknown as GlobalProperties)

    expect(items.map((item) => (item.name as () => string)())).toEqual(['Calendar', 'Tasks'])
    expect(items.map((item) => item.route)).toEqual([
      { path: '/web-calendar/' },
      { path: '/web-calendar/tasks' }
    ])
    // the calendar path is a prefix of the tasks path
    expect(items[0].isActive()).toBe(true)
    currentRoute.value.name = 'web-calendar-tasks'
    expect(items[0].isActive()).toBe(false)
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

  it('ships the compiled translations', () => {
    const { translations } = setupApp()
    expect(translations.de['Web Calendar']).toBe('Web-Kalender')
  })
})
