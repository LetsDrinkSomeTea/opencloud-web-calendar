import translations from '../l10n/translations.json'
import {
  defineWebApplication,
  type AppNavigationItem,
  type GlobalProperties
} from '@opencloud-eu/web-pkg'
import '@opencloud-eu/extension-sdk/tailwind.css'
import { RouteRecordRaw } from 'vue-router'
import { useGettext } from 'vue3-gettext'
import { initCalendarConfig } from './config'
import { APP_ID, APP_ROUTE_NAME, useCalendarExtensions } from './extensions'

export default defineWebApplication({
  setup({ applicationConfig }) {
    // Validate the app config (manifest defaults merged with the admin's apps.yaml)
    initCalendarConfig(applicationConfig)

    const { $gettext } = useGettext()

    const appInfo = {
      id: APP_ID,
      name: $gettext('Web Calendar'),
      icon: 'calendar',
      color: '#3788d8'
    }

    const routes: RouteRecordRaw[] = [
      {
        path: '/',
        name: APP_ROUTE_NAME,
        component: () => import('./views/Calendar.vue'),
        meta: {
          authContext: 'user',
          title: $gettext('Web Calendar')
        }
      },
      {
        path: '/tasks',
        // Namespaced by the runtime to `web-calendar-tasks`
        name: 'tasks',
        component: () => import('./views/Tasks.vue'),
        meta: {
          authContext: 'user',
          title: $gettext('Tasks')
        }
      }
    ]

    // Shown by OpenCloud in the left sidebar (like Personal/Shares/Spaces in Files)
    const navItems = ({ $router }: GlobalProperties): AppNavigationItem[] => [
      {
        name: () => $gettext('Calendar'),
        icon: 'calendar',
        route: { path: `/${appInfo.id}/` },
        // `/web-calendar/` is a prefix of the tasks route as well
        isActive: () => $router.currentRoute.value.name !== `${appInfo.id}-tasks`,
        priority: 10
      },
      {
        name: () => $gettext('Tasks'),
        icon: 'checkbox-circle',
        route: { path: `/${appInfo.id}/tasks` },
        priority: 20
      }
    ]

    return {
      appInfo,
      routes,
      navItems,
      translations,
      // App menu entry and the "Import into calendar" action for .ics files in the Files app
      extensions: useCalendarExtensions(appInfo)
    }
  }
})
