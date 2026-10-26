# Calendar for OpenCloud

A CalDAV calendar application integrated as a native [OpenCloud](https://opencloud.eu/) web extension. View, create, edit and manage calendar events directly within OpenCloud.

![Screenshot](screenshot.png)

## Features

- CalDAV integration with OpenCloud backend
- Month, week, day and agenda (list of the next 30 days) views
- Search events by title, location and description (case and diacritics insensitive)
- Keyboard shortcuts: `t` jumps to today, `←` / `→` go to the previous / next period
- Create, edit and delete calendar events
- Drag & drop event rescheduling
- Multiple calendar support with color coding
- Rename and recolor calendars
- Import `.ics` files, also straight from the Files app ("Import into calendar")
- Export whole calendars or single events as `.ics`
- Subscription URL for external CalDAV clients (Thunderbird, DAVx⁵, Apple Calendar, …)
- All-day and timed events
- Event conflict detection and resolution
- Auto-save with optimistic updates
- Reminders (`VALARM`) shown as OpenCloud and browser notifications while the app is open
- Attendees (`ATTENDEE`/`ORGANIZER`) with participation status, accept/tentative/decline
- Tasks (`VTODO`) at `/web-calendar/tasks` ("Tasks" in the left navigation): lists of all collections that support tasks, quick add, due/start dates, priority, status, progress and categories. Recurring tasks show their next open occurrence and are completed one occurrence at a time; edits apply to the whole series
- Translated into German (more languages welcome), following the language selected in OpenCloud

## Installation

### 1. Copy the Extension Files

Download `web-calendar.zip` from the [Releases](https://github.com/LetsDrinkSomeTea/opencloud-web-calendar/releases) page. The archive already contains a top-level `web-calendar/` folder, so extract it directly into the OpenCloud web apps directory:

```bash
unzip web-calendar.zip -d /var/lib/opencloud/web/assets/apps/
```

This results in `/var/lib/opencloud/web/assets/apps/web-calendar/manifest.json`. OpenCloud automatically discovers extensions placed in this directory.

### 2. Configure Content Security Policy (CSP)

Allow `data:` in `font-src` so FullCalendar's bundled icon font can load.
Additionally, allow `https://nominatim.openstreetmap.org/` in `connect-src` to enable location search features:

```yaml
# csp.yaml
directives:
  font-src:
    - "'self'"
    - 'data:'
  connect-src:
    - "'self'"
    - 'https://nominatim.openstreetmap.org/'
```

### 3. Configure CalDAV Backend Proxy (if not already setup)

The calendar requires a CalDAV backend (e.g., Radicale). If your OpenCloud proxy is not already configured to route CalDAV requests, add the following routes:

```yaml
# proxy.yaml
additional_policies:
  - name: default
    routes:
      - endpoint: /caldav/
        backend: http://your-caldav-server:5232
        remote_user_header: X-Remote-User
        skip_x_access_token: true
        additional_headers:
          - X-Script-Name: /caldav
      - endpoint: /.well-known/caldav
        backend: http://your-caldav-server:5232
        remote_user_header: X-Remote-User
        skip_x_access_token: true
        additional_headers:
          - X-Script-Name: /caldav
```

### 4. Restart OpenCloud

Restart OpenCloud to pick up the new extension and configuration.

## Configuration

The defaults live under `config` in `src/manifest.json` (copied into `manifest.json` of the
release). Administrators can override them in OpenCloud's `apps.yaml`:

```yaml
# apps.yaml
web-calendar:
  config:
    caldavBasePath: /caldav
    locationSearch:
      enabled: true
      url: https://nominatim.openstreetmap.org/search
    defaultView: dayGridMonth
    firstDayOfWeek: 1
    searchRangeMonths: 12
```

| Option                   | Default                                      | Description                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caldavBasePath`         | `/caldav`                                    | Path of the CalDAV endpoint on the OpenCloud origin (the proxy route). The app only sends requests below this path.                                                                         |
| `locationSearch.enabled` | `true`                                       | Suggest locations while typing in the event dialog. Set to `false` to disable all requests to the geocoder.                                                                                 |
| `locationSearch.url`     | `https://nominatim.openstreetmap.org/search` | [Nominatim](https://nominatim.org/release-docs/latest/api/Search/) compatible search endpoint. Absolute `http(s)` URL or a same-origin path. Remember to allow it in the CSP `connect-src`. |
| `defaultView`            | `dayGridMonth`                               | View shown when no view is given in the URL: `dayGridMonth`, `timeGridWeek`, `timeGridDay` or `listAgenda` (`month`, `week`, `day`, `agenda` are accepted as well).                         |
| `firstDayOfWeek`         | _unset_                                      | First day of the week, `0` (Sunday) to `6` (Saturday). When unset it is derived from the user's language.                                                                                   |

| `searchRangeMonths` | `12` | The search queries the server (CalDAV `text-match`) for events this many months before and after today, `0` to `120`. With `0` only the events already loaded for the calendar view are searched. |

Invalid values are ignored (with a warning in the browser console) and the default is used.

For local development, `src/config.json` can override the values for the dev server
(`pnpm vite`), `dev/docker/opencloud/apps.yaml` is used by `docker compose`.

The current view, date and search are kept in the URL (e.g. `/web-calendar/?view=week&date=2026-10-26`,
`?view=agenda&q=meeting`), so reloading the page or sharing the link restores them.

The search matches every word of the query against the title, location and description of events,
ignoring case and diacritics. Events already loaded are filtered in the browser; the server is
queried with one CalDAV `text-match` REPORT per property and calendar for the longest word of the
query. Radicale (as of 3.8) compares texts lower cased but not diacritics insensitive, so outside the
loaded range "muller" does not find "Müller" ("müller" does).

## Reminders and Invitations

**Reminders.** Reminders are stored as `VALARM` components in the event, so other CalDAV
clients (phones, Thunderbird, …) show them as well. The web app shows `DISPLAY` and `AUDIO`
reminders of the loaded events only while it is open in a browser tab: as an OpenCloud
notification and, after the user allowed it via "Enable browser notifications" in the event
dialog, as a browser notification. Reminders the app cannot edit (e.g. `EMAIL` alarms or absolute
triggers created by other clients) are kept unchanged when an event is saved.

**Invitations are not sent.** Attendees can be added (OpenCloud users or any email address) and
are saved as `ATTENDEE` properties, and invited users can accept, tentatively accept or decline
events in calendars they can write to. Delivering invitations and replies (iTIP, RFC 5546)
requires server-side scheduling (CalDAV Scheduling, RFC 6638, or iMIP email), which
[Radicale](https://radicale.org/v3.html) does not implement (see the open feature request
[Kozea/Radicale#1945](https://github.com/Kozea/Radicale/issues/1945)). The app does not fake it:

- Radicale 3.5.5 and later can email attendees when an event is created, changed or deleted
  ([`[hook] type = email`](https://radicale.org/v3.html)). These are notifications with the
  event attached, attendee replies are not processed. Configure it on the Radicale server if you
  want attendees to be notified.
- "Download invitation" in the event dialog saves the event as an iTIP request
  (`METHOD:REQUEST`), which can be sent to attendees by email manually.

## Importing `.ics` files from the Files app

`.ics` files in the Files app get an **Import into calendar** action in their context menu. It
opens the calendar (`/web-calendar/?importFile=<file id>&importName=<file name>`), downloads the
file through the OpenCloud WebDAV API and shows the import dialog with the file preselected, where
the target (new or existing calendar) is chosen. The query parameters are removed from the URL
once the file has been loaded.

## External calendar clients (subscription URL)

**Copy subscription URL** in a calendar's menu copies the CalDAV address of the calendar
(e.g. `https://cloud.example.com/caldav/<user>/<calendar>/`). **Export as .ics** downloads the
whole calendar (all events and tasks, time zones deduplicated) as a single file instead.

External clients cannot log in with OpenID Connect, so they authenticate with **HTTP Basic auth
using the OpenCloud user name and an app token** as password. The OpenCloud proxy validates the
token (`auth-app` service, `PROXY_ENABLE_APP_AUTH`, enabled by default) and forwards the request
with the `X-Remote-User` header like for the web app, so no change to the CalDAV route is needed.

App tokens can be created via the API of the `auth-app` service (see the
[auth-app documentation](https://github.com/opencloud-eu/opencloud/tree/main/services/auth-app)):

```bash
# authenticated as the user, e.g. with the access token of a browser session
curl -X POST 'https://cloud.example.com/auth-app/tokens?expiry=8760h' \
     -H 'Authorization: Bearer <access token>'
```

or by an admin with `opencloud auth-app create --user-name=<user> --expiration=8760h` (needs access
to the reva gateway). Newer OpenCloud versions may also offer app tokens in the account settings. Use the
returned `token` as the password in the calendar client. App tokens are not invalidated when the
user is disabled in an external IdP, and they expire after the given time.

## Kubernetes / Helm Deployment

For Kubernetes deployments using the OpenCloud Helm chart, you need to configure the following:

### 1. Configure CSP in Helm Values

```yaml
# values.yaml or ConfigMap
csp:
  directives:
    font-src:
      - "'self'"
      - 'data:'
    connect-src:
      - "'self'"
      - 'https://nominatim.openstreetmap.org/'
```

### 2. Configure CalDAV Proxy Routes (if not already setup)

```yaml
# proxy.yaml ConfigMap
additional_policies:
  - name: default
    routes:
      - endpoint: /caldav/
        backend: http://opencloud-radicale:5232
        remote_user_header: X-Remote-User
        skip_x_access_token: true
        additional_headers:
          - X-Script-Name: /caldav
      - endpoint: /.well-known/caldav
        backend: http://opencloud-radicale:5232
        remote_user_header: X-Remote-User
        skip_x_access_token: true
        additional_headers:
          - X-Script-Name: /caldav
```

### 3. Copy Extension Files

Use an init container (or a volume prepared otherwise) to extract `web-calendar.zip` into the apps directory. As the archive already contains the `web-calendar/` folder, extract it into `/var/lib/opencloud/web/assets/apps/`, not into `apps/web-calendar/`:

```bash
unzip web-calendar.zip -d /var/lib/opencloud/web/assets/apps/
# -> /var/lib/opencloud/web/assets/apps/web-calendar/manifest.json
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/installation) (see `packageManager` field in `package.json` for the exact version)
- Docker and Docker Compose (for local dev server)

### Setup

```bash
pnpm install
pnpm build:w
```

### Local Development Server

```bash
docker compose up
```

Then open `https://host.docker.internal:9200` (default credentials: `admin`/`admin`).

### Build for Production

```bash
pnpm build
```

The production build is output to the `dist/` directory.

### Testing

Run the unit tests (vitest; starts in watch mode, add `--run` for a single run):

```bash
pnpm test:unit
pnpm test:unit --run
```

CI additionally runs linting, the format check and the type check:

```bash
pnpm lint
pnpm format:check
pnpm check:types
```

### Translations

Translations use [vue3-gettext](https://github.com/jshmrtn/vue3-gettext), as described in the
[OpenCloud extension docs](https://docs.opencloud.eu/docs/dev/web/extension-system/advanced-topics/translations).
Use `$gettext('…')` in templates and `const { $gettext, $ngettext } = useGettext()` in scripts. Pass
plain string literals (the extractor cannot read variables or template literals) and put dynamic
values into `%{placeholders}`: `$gettext('Share calendar: %{name}', { name })`.

```bash
pnpm l10n:extract   # update l10n/template.pot and l10n/locale/<lang>/app.po (needs GNU gettext: msgmerge, msginit, msgattrib)
pnpm l10n:compile   # compile the .po files into l10n/translations.json, which is bundled with the app
```

Translate the new entries in `l10n/locale/<lang>/app.po`, then run `pnpm l10n:compile` and commit the
`.pot`, `.po` and `translations.json` files. To add a language, add it to `locales` in
`gettext.config.cjs` and run `pnpm l10n:extract`.

## Architecture

The application is built with:

- **Vue 3** with Composition API
- **FullCalendar** for calendar rendering
- **CalDAV** protocol for calendar synchronization
- **ical.js** for iCalendar parsing and generation
- **Tailwind CSS** for styling

### Key Components

- `CalendarView.vue` - Main calendar component using FullCalendar
- `CalendarToolbar.vue` - Navigation and view switching controls
- `CalendarSidebar.vue` - Calendar list with visibility toggles and per-calendar actions (edit, share, export, subscription URL, delete)
- `EventDialog.vue` - Event creation and editing modal

### Composables

- `useCalendars` - Calendar list management
- `useEvents` - Event fetching and caching
- `useEventEditor` - Event creation/editing state machine

### CalDAV Integration

The CalDAV client (`src/caldav/client.ts`) handles:

- Calendar discovery via PROPFIND
- Event fetching via REPORT
- Event creation, updates and deletion via PUT/DELETE
- Calendar creation (MKCALENDAR), renaming/recoloring (PROPPATCH) and export (REPORT, `src/caldav/export.ts`)
- ETag-based conflict detection

## License

[Apache-2.0](LICENSE)
