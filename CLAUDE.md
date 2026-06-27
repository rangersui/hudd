# hudd

Metadata-driven desktop overlay daemon. Electron + CDP on port 9500.

## Structure

```
hudd/
├── package.json        npm package — bin entries + dependencies
├── bin/
│   ├── hudd.js         daemon CLI (start/stop)
│   └── hudsh.js        page CLI (run/ls/kill/status/attach)
├── lib/
│   └── cdp.js          CDP HTTP + WebSocket helpers
└── hud.js              Electron main process (pure runtime, zero widget names)
```

HTML widget files are user content — gitignored, not part of the runtime.

## Architecture

hud.js is a pure runtime shell. Zero hardcoded widget names or positions.

- **Metadata-driven**: HTML files declare intent via `<meta name="hudd" content='{"width":400,"position":"bottom-left","resizable":true}'>`. hud.js reads the tag and creates BrowserWindow accordingly.
- **`type: "overlay"`**: fullscreen click-through mode. All other widgets are normal floating panels.
- **App dir** (`__dirname`): loads `.html` files that have `<meta name="hudd">`. No meta → skipped.
- **Hooks dir** (`%LOCALAPPDATA%\hudd\hooks\`): loads ALL `.html` files (meta optional, defaults applied). Also loads `.js` files via `require()` in main process.
- **fs.watch on hooks**: drop/modify/delete → auto load/reload/unload.
- **Single-instance**: second `electron hud.js file.html` forwards to running instance via `requestSingleInstanceLock`.
- **Generic IPC**: `minimize-widget`, `close-widget`, `restore-widget`, `reopen-widget`, `open-file`, `set-bounds`, `get-own-bounds`, `list-widgets`, `list-available`, `set-ignore-mouse`. Zero widget-specific handlers.
- **broadcast()**: lifecycle events sent to ALL widgets, not targeted.
- **Right-click → DevTools**: context menu on any widget for inspect/devtools/reload/close.

## Key paths

- **daemon.json**: `%LOCALAPPDATA%\hudd\daemon.json` — PID, port, app dir
- **hooks dir**: `%LOCALAPPDATA%\hudd\hooks\` — drop HTML/JS here → auto-loads

## Widget IDs

- App dir: `meta.id` field, or filename without `.html`
- Hooks: `hook-<filename>` (e.g., `hooks/mgr.html` → `hook-mgr`)

## Meta tag reference

```html
<meta name="hudd" content='{
  "id": "mywidget",
  "type": "overlay",
  "width": 400,
  "height": 300,
  "position": "bottom-left",
  "resizable": true,
  "trackPosition": true,
  "webviewTag": true,
  "x": 100, "y": 200
}'>
```

- `type: "overlay"` → fullscreen, click-through, screen-saver level
- `position`: `top-left`, `top-right`, `bottom-left`, `bottom-right`, `bottom-center`, `center`
- `trackPosition`: emits `position-changed` on move/resize
- No meta in hooks dir → defaults to `{ resizable: true }`

## Dev commands

```bash
npm install             # install electron + ws + xterm
npm link                # register hudd/hudsh globally
hudd daemon             # start daemon (foreground)
hudd stop               # stop daemon
hudsh ls                # list CDP targets
hudsh run <page> "code" # evaluate JS in a page
```

## Chromium

Stripped to bare rendering shell. All unnecessary features disabled (sync, translate, extensions, speech, print, WebRTC, notifications, safe browsing, privacy sandbox, etc.). ~65MB memory footprint.

## Conventions

- `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false` — full Node.js in renderer
- Draggable headers: `-webkit-app-region: drag`
- Transparent: `background: transparent` + `backgroundColor: "#00000000"`
- Always-on-top, frameless, skip-taskbar
- IPC for internal lifecycle. External control via CDP or hooks dir.
