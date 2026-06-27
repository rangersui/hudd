# hudd

Display server. Rendering protocol is HTML. Every window is a Node.js runtime. Mechanism only, zero policy.

## Structure

```
hudd/
├── package.json        npm package — bin entries + dependencies
├── bin/
│   ├── hudd.js         daemon CLI (start/stop) + auth gateway
│   └── hudsh.js        page CLI (run/ls/kill/status/attach)
├── lib/
│   ├── cdp.js          CDP client with token auth
│   └── gateway.js      CDP pipe → authenticated TCP gateway
└── hud.js              Electron main process (pure runtime, zero widget names)
```

HTML widget files are user content — gitignored, not part of the runtime.

## Architecture

hud.js is a pure runtime shell. Provides mechanism, not policy. All behavior configurable via meta tags — the runtime only supplies defaults.

- **Metadata-driven**: HTML files declare intent via `<meta name="hudd" content='...'>`. Any window property (frame, transparency, shadow, level, click-through, etc.) can be set in the meta tag. Undeclared fields fall through to `DEFAULTS`, or `OVERLAY_DEFAULTS` for `type: "overlay"`.
- **App dir** (`__dirname`): loads `.html` files that have `<meta name="hudd">`. No meta → skipped.
- **Hooks dir** (`%LOCALAPPDATA%\hudd\hooks\`): loads ALL `.html` files (meta optional, defaults applied). Also loads `.js` files via `require()` in main process.
- **External dir** (`%LOCALAPPDATA%\hudd\external\`): created at boot, never loaded. Visible in `list-available` with `untrusted: true`. The directory is the UX — putting a file here is a deliberate act that says "this is untrusted content." Zero attack surface: no code paths touch it.
- **fs.watch on hooks**: drop/modify/delete → auto load/reload/unload.
- **Single-instance**: second `electron hud.js file.html` forwards to running instance via `requestSingleInstanceLock`.
- **Daemon mode**: stays alive with zero widgets — new widgets arrive via hooks dir, CLI, or IPC.
- **Main eval**: persistent `vm.createContext` in the main process — windowless Node.js runtime. `hudsh run "code"` (no page arg) evals here via IPC through the gateway. const/let/var all persist across calls.
- **Generic IPC**: `minimize-widget`, `close-widget`, `restore-widget`, `reopen-widget`, `open-file`, `set-bounds`, `get-own-bounds`, `list-widgets`, `list-available`, `set-ignore-mouse`. Zero widget-specific handlers.
- **broadcast()**: lifecycle events sent to ALL widgets, not targeted.
- **Right-click → DevTools**: context menu on any widget for inspect/devtools/reload/close.

## Security

### Trust model

Electron's default security model (sandbox + contextIsolation) exists to protect
against untrusted content in the renderer — third-party iframes, user-generated
HTML, OAuth popups. The renderer is treated as a hostile browser tab; Node access
goes through IPC to the main process.

hudd widgets are your own code running on your own machine. There is no untrusted
content. The trust boundary is not between renderer and main process — it is at
who can connect to the daemon and who can write to the hooks directory.

### Scorched earth: protection layer off, rendering layer on

All Chromium features are classified as either **protection layer** (exists because
browsers don't trust web pages) or **rendering layer** (IS the rendering engine).

- **KILL** — CORS, CSP, permissions, storage sandbox, Service Workers, certificates,
  mixed content, cookie policy, safe browsing, site isolation, A/B experiments.
- **KEEP** — Canvas, WebGL, Web Audio, MediaStream, CSS animations, `<video>`,
  ResizeObserver, IntersectionObserver, requestAnimationFrame.

`require('fs')` is storage. `require('better-sqlite3')` is the database.
`navigator.mediaDevices.getUserMedia()` into `<video>.srcObject` is the camera.
Browser storage and permissions exist because web pages can't touch the filesystem
or hardware — here they can.

### Gateway auth

Electron runs with `--remote-debugging-pipe` — zero TCP ports from Chrome. The gateway process (`bin/hudd.js`) opens the TCP port with token auth.

```
client (hudsh) ─── Bearer token ──→ gateway :9500 ─── fd 3/4 pipe ──→ Electron
                                    (bin/hudd.js)                     (no TCP)
```

- **Token**: `crypto.randomBytes(16)` (128-bit), stored in `daemon.json`
- **Auth**: `Authorization: Bearer <token>` header, or `?token=` query (for DevTools)
- **Comparison**: `crypto.timingSafeEqual` (constant-time)
- **File protection**: DACL on Windows (`icacls OWNER RIGHTS`), chmod 700/600 on POSIX
- **Duplicate guard**: daemon refuses to start if existing PID is alive
- **DACL failure**: fatal — daemon exits if directory cannot be secured

### Renderer

`nodeIntegration: true`, `sandbox: false`, `webSecurity: false`. Every widget is
a Node.js process with a DOM. `require()` anything, access the filesystem, spawn
processes, open sockets — same as SSH into a live runtime. Treat accordingly.

## Key paths

- **daemon.json**: `%LOCALAPPDATA%\hudd\daemon.json` — PID, port, token
- **hooks dir**: `%LOCALAPPDATA%\hudd\hooks\` — drop HTML/JS here → auto-loads
- **external dir**: `%LOCALAPPDATA%\hudd\external\` — untrusted holding area (visible, never loaded)

## Widget IDs

- App dir: `meta.id` field, or filename without `.html`
- Hooks: `hook-<filename>` (e.g., `hooks/mgr.html` → `hook-mgr`)
- External: `ext-<filename>` (visible in `list-available`, never loaded)

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
| `HUDD_CDP_PORT` | — | Raw CDP port (dev mode, no auth, bypasses gateway) |
| `HUDD_RESTORE_KEY` | `F10` | Global shortcut to restore all hidden widgets |
| `HUDD_TOKEN` | — | Override token (client-side, for remote access) |
| `HUDD_PORT` | — | Override gateway port (client-side) |

## Dev commands

```bash
npm install             # install electron + ws
npm link                # register hudd/hudsh globally
hudd daemon             # start daemon (foreground)
hudd stop               # stop daemon
hudsh ls                # list CDP targets
hudsh run "code"        # evaluate JS in main process (persistent, no DOM)
hudsh run <page> "code" # evaluate JS in a page
```

## Chromium flags

Scorched earth: kill protection layer, keep rendering layer. Flags are maintained in **two places** that must stay in sync:

- `bin/hudd.js` — spawn command line (required for pre-init flags like `--no-sandbox`)
- `hud.js` — `appendSwitch()` (belt-and-suspenders for direct `electron hud.js`)

Same flags, different format. If you add/remove a flag, update both files.

## Persistent runtime

Two persistent runtimes, one daemon:

- **Main process** (`hudsh run "code"`): `vm.createContext` in Electron main process. No DOM. const/let/var all persist. Has access to `require`, Electron APIs (`app`, `BrowserWindow`, etc.), and hudd internals (`widgets`, `broadcast`). Routed via IPC through the gateway (`POST /json/eval`).
- **Widget processes** (`hudsh run <page> "code"`): Each widget is a renderer with Node.js + DOM. Variables persist on `window.*`. Routed via CDP WebSocket.

Both are function calls into live processes, not fresh scripts.

**Decision rule**: needs `document` → widget (one HTML file = one concern). Doesn't need DOM → main process. Servers, shared state, system tasks, automation → main. Visual tools → widget, one file per tool, keep each small and focused. Don't run servers inside widgets — `nodeIntegration` liberates the client (filesystem, hardware, processes), not for hosting services. Widget = native client, main = server.

## Extending hudd

### Adding a new meta field

1. Add to `DEFAULTS` or `OVERLAY_DEFAULTS` in `hud.js` (if it needs a default)
2. Use `d.<field>` in `createWidget()` — the layering `{ ...DEFAULTS, ...OVERLAY_DEFAULTS, ...meta }` handles resolution
3. Update meta tag table in CLAUDE.md, SKILL.md, README.md

### Adding a new directory type

Follow the hooks/external pattern: constant alongside `DATA_DIR`, `mkdirSync` in `whenReady`, `loadDir` with prefix, optionally `watchDir`. Update `list-available` and docs.

### Do NOT add widget-specific IPC handlers

hud.js is a pure runtime shell — zero widget names, zero widget-specific logic. If a widget needs custom behavior, it goes in the widget's own `<script>`, not in hud.js. All IPC channels are generic and widget-agnostic. Do not add `ipcMain.on("my-widget-does-x", ...)`.

## Testing

No automated test suite. Verify changes manually:

```bash
hudd daemon                    # start
hudsh ls                       # all expected widgets listed?
hudsh run <page> "1+1"         # CDP eval works?
# drop a .html in hooks dir   # hot-reload works?
# right-click a widget        # DevTools opens?
hudd stop                      # clean shutdown?
```

## Conventions

- `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false` — full Node.js in renderer
- Draggable headers: `-webkit-app-region: drag`
- All window chrome (transparent, frame, shadow, etc.) configurable via meta — defaults in `DEFAULTS` object
- Right-click any widget → DevTools / Inspect / Reload / Close
- Restore key (default F10) → restore all hidden widgets
- IPC for internal lifecycle. External control via CDP or hooks dir.
