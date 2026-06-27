# hudd

Metadata-driven desktop overlay daemon. Mechanism only, zero policy.

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

hud.js is a pure runtime shell. Provides mechanism, not policy. All behavior configurable via meta tags — the runtime only supplies defaults.

- **Metadata-driven**: HTML files declare intent via `<meta name="hudd" content='...'>`. Any window property (frame, transparency, shadow, level, click-through, etc.) can be set in the meta tag. Undeclared fields fall through to `DEFAULTS`, or `OVERLAY_DEFAULTS` for `type: "overlay"`.
- **App dir** (`__dirname`): loads `.html` files that have `<meta name="hudd">`. No meta → skipped.
- **Hooks dir** (`%LOCALAPPDATA%\hudd\hooks\`): loads ALL `.html` files (meta optional, defaults applied). Also loads `.js` files via `require()` in main process.
- **fs.watch on hooks**: drop/modify/delete → auto load/reload/unload.
- **Single-instance**: second `electron hud.js file.html` forwards to running instance via `requestSingleInstanceLock`.
- **Daemon mode**: stays alive with zero widgets — new widgets arrive via hooks dir, CLI, or IPC.
- **Generic IPC**: `minimize-widget`, `close-widget`, `restore-widget`, `reopen-widget`, `open-file`, `set-bounds`, `get-own-bounds`, `list-widgets`, `list-available`, `set-ignore-mouse`. Zero widget-specific handlers.
- **broadcast()**: lifecycle events sent to ALL widgets, not targeted.
- **Right-click → DevTools**: context menu on any widget for inspect/devtools/reload/close.

## Key paths

- **daemon.json**: `%LOCALAPPDATA%\hudd\daemon.json` — PID, port, app dir
- **hooks dir**: `%LOCALAPPDATA%\hudd\hooks\` — drop HTML/JS here → auto-loads

## Widget IDs

- App dir: `meta.id` field, or filename without `.html`
- Hooks: `hook-<filename>` (e.g., `hooks/mgr.html` → `hook-mgr`)

## Defaults (layered)

Config resolution: `DEFAULTS` → `OVERLAY_DEFAULTS` (if `type: "overlay"`) → meta tag.
Meta tag wins. Anything not declared falls through.

```
DEFAULTS:         { transparent: true, frame: false, hasShadow: false, roundedCorners: false,
                    backgroundColor: "#00000000", windowType: "toolbar",
                    alwaysOnTop: true, skipTaskbar: true, level: "pop-up-menu",
                    resizable: false, movable: true, focusable: true,
                    defaultWidth: 360, defaultHeight: 260, pad: 30,
                    minWidth: 200, minHeight: 120 }

OVERLAY_DEFAULTS: { focusable: false, resizable: false, movable: false,
                    level: "screen-saver", clickThrough: true }
```

## Meta tag reference

All fields optional. Undeclared → falls through to defaults above.

```html
<meta name="hudd" content='{"width":400,"position":"bottom-left","resizable":true}'>
```

| Field | Default | Overlay | Description |
|-------|---------|---------|-------------|
| `id` | filename | — | Widget ID |
| `type` | normal | — | `"overlay"` → fullscreen click-through |
| `width`, `height` | 360×260 | fullscreen | Window size px |
| `position` | cascade | — | `top-left` `top-right` `bottom-left` `bottom-right` `bottom-center` `center` |
| `x`, `y` | from position | — | Exact position (overrides position) |
| `pad` | 30 | — | Edge padding for position |
| `inset` | — | 1 | Overlay edge inset (taskbar compat) |
| `resizable` | false | false | Allow resize |
| `movable` | true | false | Allow move |
| `focusable` | true | false | Can receive focus |
| `clickThrough` | false | true | Ignore mouse (with forward) |
| `transparent` | true | — | Transparent background |
| `frame` | false | — | Window frame |
| `hasShadow` | false | — | Window shadow |
| `roundedCorners` | false | — | Rounded corners |
| `backgroundColor` | `#00000000` | — | Background color |
| `skipTaskbar` | true | — | Hide from taskbar |
| `alwaysOnTop` | true | — | Stay on top |
| `level` | `pop-up-menu` | `screen-saver` | alwaysOnTop level |
| `windowType` | `toolbar` | — | Electron window type |
| `minWidth`, `minHeight` | 200×120 | — | Min size (when resizable) |
| `trackPosition` | — | — | Emit `position-changed` on move/resize |
| `webviewTag` | — | — | Enable `<webview>` tag |

No meta in hooks dir → defaults to `{ resizable: true }`.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HUDD_CDP_PORT` | `9500` | Chrome DevTools Protocol port |
| `HUDD_RESTORE_KEY` | `F10` | Global shortcut to restore all hidden widgets |

## Dev commands

```bash
npm install             # install electron + ws
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
- All window chrome (transparent, frame, shadow, etc.) configurable via meta — defaults in `DEFAULTS` object
- Right-click any widget → DevTools / Inspect / Reload / Close
- Restore key (default F10) → restore all hidden widgets
- IPC for internal lifecycle. External control via CDP or hooks dir.
