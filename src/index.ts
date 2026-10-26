import translations from '../l10n/translations.json'
import { defineWebApplication, Extension, AppMenuItemExtension } from '@opencloud-eu/web-pkg'
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
      translations,
      extensions: extensions()
    }
  }
})
