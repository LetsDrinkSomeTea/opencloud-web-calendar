import translations from '../l10n/translations.json'
import { defineWebApplication } from '@opencloud-eu/web-pkg'
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
      }
    ]

    return {
      appInfo,
      routes,
      translations,
      // App menu entry and the "Import into calendar" action for .ics files in the Files app
      extensions: useCalendarExtensions(appInfo)
    }
  }
})
