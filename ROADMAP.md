# Roadmap

Planned work to bring the calendar in line with the OpenCloud extension guidelines
([web-app-skeleton](https://github.com/opencloud-eu/web-app-skeleton),
[extension docs](https://docs.opencloud.eu/docs/dev/web/extension-system/getting-started))
and to close the most important feature gaps.

## 1. OpenCloud 8 compatibility ✅

- [x] Bump `@opencloud-eu/*` packages to `^8.0.0`
- [x] Align tooling with the skeleton (vite 8, vitest 5, typescript 6, eslint 10, pnpm 11)
- [x] Move `@opencloud-eu/extension-sdk` to `devDependencies`, add `@opencloud-eu/design-system`
- [x] Use the plain OpenCloud eslint config, drop `ts-node`, `@types/node` and `test-parser.ts`
- [x] Pin the dev server image to 8.1.0 and mount `dist` as `web-calendar` in `docker-compose.yml`
- [x] Run lint, format check, type check and unit tests in CI
- [x] Add `minimumReleaseAge` to the renovate config

## 2. Fix time zone handling ✅

Events are currently written as UTC without a `TZID` (`formatICALDateTime` in
`src/caldav/ics-utils.ts`), so recurring events shift by one hour after a daylight saving
time change. `VTIMEZONE` components sent by other clients are not registered.

- [x] Write `DTSTART`/`DTEND` with the user's `TZID` and include a `VTIMEZONE`
- [x] Register `VTIMEZONE` components from fetched and imported calendars with `ICAL.TimezoneService`
- [x] Add tests for recurring events across DST changes

## 3. Use the OpenCloud platform

### Translations

The app ships its own i18n (`src/i18n/translations.ts`, `t()`), which only supports English
and German and does not follow language changes made in OpenCloud.

- [x] Switch to `vue3-gettext` (`useGettext`, `$gettext`)
- [x] Add `l10n/` with `template.pot`, `.po` files and the `l10n:extract` / `l10n:compile` scripts
- [x] Return `translations` from `defineWebApplication`
- [x] Remove `useLanguage` and `src/i18n/`

### Design system

There are no design system components; dialogs, buttons, inputs and the toast are custom
built and lack focus handling, keyboard support and ARIA attributes.

- [ ] Replace custom buttons and inputs with `OcButton`, `OcTextInput`, `OcSelect` etc.
- [ ] Use `useModals` instead of the custom `Teleport` dialogs
- [ ] Use `useMessages` (`showMessage` / `showErrorMessage`) instead of the custom toast and `console.error`

### Theming

Dark mode is detected by comparing `--oc-role-background` against a hard-coded color
(`src/composables/useTheme.ts`), and fixed Tailwind colors are overridden by a global,
unscoped `!important` stylesheet in `src/views/Calendar.vue`.

- [ ] Replace fixed colors (`ext:bg-white`, `ext:text-gray-*`, …) with role classes (`ext:bg-role-surface`, `ext:text-role-on-surface`, …)
- [ ] Remove `useTheme` and the global dark mode overrides

### HTTP and authentication

- [x] Use `useClientService().graphAuthenticated` instead of raw `fetch` calls to `/graph/v1.0/users` (`src/composables/useUserProfiles.ts`)
- [x] Read the access token and user from the stores through their typed API instead of casts and polling (`src/caldav/auth.ts`)
- [x] Stop sending `X-Remote-User` from the client; the proxy sets it

### Configuration

- [x] Add `config` defaults to `src/manifest.json` and read them via `applicationConfig`
- [x] Make configurable: CalDAV base path, location search on/off and its URL, default view, first day of the week

### Routing

- [x] Read join links via `useRoute()` / `router.replace` instead of `window.location` and `hashchange`/`popstate` listeners
- [x] Keep the current view and date in the URL so a reload restores them

## 4. Features

- [ ] Reminders (`VALARM`)
- [ ] Attendees and invitations (`ATTENDEE`, `ORGANIZER`, iTIP)
- [ ] Tasks (`VTODO`)
- [ ] Incremental sync via `sync-token` / `sync-collection` and periodic refresh
- [ ] Free/busy lookup
- [ ] Calendar export (`.ics`) and subscription URL
- [ ] Search and filter events
- [ ] Agenda / list view
- [ ] Rename and recolor existing calendars
- [ ] Open `.ics` files from the Files app ("Open with" / `fileExtensions`)

## 5. Quality and housekeeping

- [x] Replace the placeholder test in `tests/unit/App.spec.ts`
- [ ] Add unit tests for the CalDAV client, XML parsing/building and ICS handling (XML/discovery/calendar management/sharing done; ICS and events pending)
- [x] Resolve the remaining eslint warnings
- [x] README: release asset is `web-calendar.zip` (not `web-app-calendar.zip`) and already contains a `web-calendar/` folder, so it must be extracted into `apps/`, not `apps/web-calendar/`
- [x] Location search: drop the `User-Agent` header (browsers don't allow setting it) and send the user's language in `Accept-Language` instead of `en`
- [x] Update `homepage` and `author` in `package.json`
