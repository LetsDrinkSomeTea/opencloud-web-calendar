import translations from '../l10n/translations.json'
import {
  defineWebApplication,
  Extension,
  AppMenuItemExtension,
  AppNavigationItem,
  GlobalProperties
} from '@opencloud-eu/web-pkg'
import { urlJoin } from '@opencloud-eu/web-client'
import '@opencloud-eu/extension-sdk/tailwind.css'
import { RouteRecordRaw } from 'vue-router'
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { initCalendarConfig } from './config'

export default defineWebApplication({
  setup({ applicationConfig }) {
    // Validate the app config (manifest defaults merged with the admin's apps.yaml)
    initCalendarConfig(applicationConfig)

    const { $gettext } = useGettext()

    const appInfo = {
      id: 'web-calendar',
      name: $gettext('Web Calendar'),
      icon: 'calendar',
      color: '#3788d8'
    }

    const routes: RouteRecordRaw[] = [
      {
        path: '/',
        name: 'web-calendar',
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

    const extensions = () => {
      return computed<Extension[]>(() => {
        const menuItems: AppMenuItemExtension[] = [
          {
            id: `app.${appInfo.id}.menuItem`,
            type: 'appMenuItem',
            // Evaluated lazily so the label follows language changes
            label: () => $gettext('Web Calendar'),
            color: appInfo.color,
            icon: appInfo.icon,
            path: urlJoin(appInfo.id)
          }
        ]
        return [...menuItems]
      })
    }

    return {
      appInfo,
      routes,
      navItems,
      translations,
      extensions: extensions()
    }
  }
})
