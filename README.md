# Calendar for OpenCloud

A CalDAV calendar application integrated as a native [OpenCloud](https://opencloud.eu/) web extension. View, create, edit and manage calendar events directly within OpenCloud.

![Screenshot](screenshot.png)

## Features

- CalDAV integration with OpenCloud backend
- Month, week and day views
- Create, edit and delete calendar events
- Drag & drop event rescheduling
- Multiple calendar support with color coding
- All-day and timed events
- Event conflict detection and resolution
- Auto-save with optimistic updates
- Multi-language support (English, German) with automatic detection from user profile

## Installation

### 1. Copy the Extension Files

Download `web-calendar.zip` from the [Releases](https://github.com/LordGuenni/opencloud-web-calendar/releases) page. The archive already contains a top-level `web-calendar/` folder, so extract it directly into the OpenCloud web apps directory:

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
```

| Option                   | Default                                      | Description                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caldavBasePath`         | `/caldav`                                    | Path of the CalDAV endpoint on the OpenCloud origin (the proxy route). The app only sends requests below this path.                                                                         |
| `locationSearch.enabled` | `true`                                       | Suggest locations while typing in the event dialog. Set to `false` to disable all requests to the geocoder.                                                                                 |
| `locationSearch.url`     | `https://nominatim.openstreetmap.org/search` | [Nominatim](https://nominatim.org/release-docs/latest/api/Search/) compatible search endpoint. Absolute `http(s)` URL or a same-origin path. Remember to allow it in the CSP `connect-src`. |
| `defaultView`            | `dayGridMonth`                               | View shown when no view is given in the URL: `dayGridMonth`, `timeGridWeek` or `timeGridDay` (`month`, `week`, `day` are accepted as well).                                                 |
| `firstDayOfWeek`         | _unset_                                      | First day of the week, `0` (Sunday) to `6` (Saturday). When unset it is derived from the user's language.                                                                                   |

Invalid values are ignored (with a warning in the browser console) and the default is used.

For local development, `src/config.json` can override the values for the dev server
(`pnpm vite`), `dev/docker/opencloud/apps.yaml` is used by `docker compose`.

The current view and date are kept in the URL (e.g. `/web-calendar/?view=week&date=2026-10-26`),
so reloading the page or sharing the link restores them.

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
- `CalendarSidebar.vue` - Calendar list with visibility toggles
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
- ETag-based conflict detection

## License

[Apache-2.0](LICENSE)
