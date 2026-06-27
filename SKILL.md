---
name: hudd
description: Desktop overlay display daemon. Use when the task involves showing information to the user on screen — HUD overlays, status panels, live dashboards, detection boxes, or any visual widget. Drop an HTML file into the hooks directory to create a widget, or use hudsh to evaluate JS in existing pages. Use this skill whenever the user says "show me", "display", "draw", "overlay", "HUD", "widget", "dashboard", or wants visual output on their desktop.
---

# hudd

Metadata-driven desktop overlay daemon. Drop HTML files → widgets appear on screen.

```bash
hudd daemon             # start with auth gateway on :9500
hudsh ls                # list pages (reads token from daemon.json)
hudsh run <page> "code" # evaluate JS in a page
hudd stop               # stop daemon
```

hudd is a layer of programmable transparent glass on the desktop. It loads HTML files, reads their `<meta name="hudd">` tag, and creates BrowserWindows accordingly. No widget names are hardcoded — the HTML file IS the widget. Full DOM (canvas, WebGL, SVG, video, CSS animations) + full Node.js (`require('fs')`, `child_process`, `net`) in every page.

## Core concept

One HTML file = one BrowserWindow = one CDP page.

```
overlay.html  →  BrowserWindow  →  [page] overlay
mywidget.html →  BrowserWindow  →  [page] mywidget
```

Each page has its own DOM, JS context, and `window` object. `hudsh run <page>` executes JS in that specific page's context.

## Metadata

Widgets declare their own layout and behavior via a meta tag in `<head>`. Every field is optional — undeclared fields fall through to runtime defaults. For `type: "overlay"`, overlay-specific defaults are layered on first.

```html
<meta name="hudd" content='{"width":400,"height":300,"position":"bottom-left","resizable":true}'>
```

### Layout fields

| Field | Default | Description |
|-------|---------|-------------|
| `id` | filename | Widget ID |
| `type` | normal | `"overlay"` → fullscreen click-through |
| `width`, `height` | 360×260 | Window size px (overlay: fullscreen) |
| `position` | cascade | `top-left` `top-right` `bottom-left` `bottom-right` `bottom-center` `center` |
| `x`, `y` | from position | Exact position (overrides position) |
| `pad` | 30 | Edge padding for position calculation |
| `inset` | 1 (overlay) | Overlay edge inset for taskbar compat |

### Window chrome fields

| Field | Default | Overlay | Description |
|-------|---------|---------|-------------|
| `transparent` | true | true | Transparent background |
| `frame` | false | false | Show window frame |
| `hasShadow` | false | false | Window shadow |
| `roundedCorners` | false | false | Rounded corners |
| `backgroundColor` | `#00000000` | — | Background color |
| `windowType` | `toolbar` | — | Electron window type |
| `minWidth`, `minHeight` | 200×120 | — | Min size when resizable |

### Behavior fields

| Field | Default | Overlay | Description |
|-------|---------|---------|-------------|
| `resizable` | false | false | Allow resize |
| `movable` | true | false | Allow move |
| `focusable` | true | false | Can receive focus |
| `clickThrough` | false | true | Ignore mouse (with forward) |
| `alwaysOnTop` | true | true | Stay on top |
| `level` | `pop-up-menu` | `screen-saver` | alwaysOnTop level |
| `skipTaskbar` | true | true | Hide from taskbar |
| `trackPosition` | false | — | Emit `position-changed` on move/resize |
| `webviewTag` | false | — | Enable `<webview>` tag |

No meta tag → skipped in app dir, loaded with defaults in hooks dir.

## Where widgets live

### 1. App directory (alongside hud.js)

Scanned once at boot. Only files with `<meta name="hudd">` are loaded. No file watching — restart to pick up changes. Widget ID = `meta.id` field, or filename without `.html`.

This is where your core widgets go (overlay, analyzer, status, term, etc.).

### 2. Hooks directory (hot-reload)

```
Windows:  %LOCALAPPDATA%\hudd\hooks\
Other:    ~/hudd/hooks/
```

Scanned at boot + watched with `fs.watch`. Meta tag is optional (defaults applied). Widget ID = `hook-<filename>`.

- `.html` → BrowserWindow widget
- `.js` → `require()`'d in main process. Export a function or `{ dispose }` for cleanup on reload.

Write a file → widget appears. Modify → reloads. Delete → closes. Any external process can drop files here without knowing hudd exists.

### 3. External directory (untrusted, inert)

```
Windows:  %LOCALAPPDATA%\hudd\external\
Other:    ~/hudd/external/
```

Created at boot but never loaded. Files here are visible in `list-available` (with `untrusted: true`) but never executed. The directory is the UX — putting a file here is a deliberate act that says "this is untrusted." Widget ID = `ext-<filename>`. Zero attack surface: no code paths touch these files.

### Common rules for app + hooks (trusted)

- `-webkit-app-region: drag` on the draggable element
- `nodeIntegration: true` — `require('fs')`, `require('os')`, etc. work
- All window properties (transparent, frame, shadow, alwaysOnTop, etc.) are defaults — meta tag overrides any of them

### Example widget

```html
<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="hudd" content='{"width":200,"height":60,"position":"top-right"}'>
<title>cpu</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    background: rgba(10, 10, 25, 0.9);
    color: #0f0; font-family: monospace;
    -webkit-app-region: drag;
  }
  .content { padding: 12px; }
</style>
</head>
<body>
<div class="content"><div id="value">CPU: --</div></div>
<script>
  const os = require('os');
  setInterval(() => {
    const cpus = os.cpus();
    const idle = cpus.reduce((a, c) => a + c.times.idle, 0) / cpus.length;
    const total = cpus.reduce((a, c) => a + Object.values(c.times).reduce((s,v) => s+v, 0), 0) / cpus.length;
    document.getElementById('value').textContent = 'CPU: ' + Math.round(100 - idle/total*100) + '%';
  }, 1000);
</script>
</body></html>
```

### 2. hudsh run (real-time)

Evaluate JS in any page via CDP. Use for reading state, quick updates, or when you need a return value.

```bash
hudsh run overlay "document.title"
hudsh run overlay "require('os').hostname()"
hudsh run overlay "({ width: window.innerWidth, height: window.innerHeight })"
```

## Opening arbitrary HTML files

Any HTML file can be opened as a widget:

```bash
# Via command line (single-instance — forwards to running hudd)
electron hud.js /path/to/file.html

# Via IPC from any page
hudsh run overlay "require('electron').ipcRenderer.send('open-file', 'C:\\\\path\\\\to\\\\file.html')"
```

## Persistent Node.js runtime

Each widget is a long-lived Node.js process with a persistent namespace and a DOM. Variables, connections, servers, timers, imported modules all survive across `hudsh run` calls. The page stays alive until closed or the daemon stops. Think of `hudsh run <page>` as a function call into a live runtime — not a fresh script execution.

```bash
hudsh run work "window.db = require('better-sqlite3')('app.db')"
# ... 100 calls later ...
hudsh run work "window.db.prepare('SELECT count(*) FROM users').get()"
# { 'count(*)': 42 }  — same connection, never closed
```

### What persists

| What | Persists? | Why |
|------|-----------|-----|
| `window.x = 1` | Yes | property on window object |
| `var x = 1` | Yes | var hoists to window in sloppy mode |
| `let x = 1` | No | block-scoped to the evaluate call |
| DOM changes | Yes | the DOM is the page |
| `require()` modules | Yes | cached in `require.cache` |
| `setInterval` / `setTimeout` | Yes | event loop keeps running |
| TCP/WebSocket/HTTP servers | Yes | bound to the process |
| Spawned child processes | Yes | until explicitly killed |

### Node.js in renderer

`nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`. Full Node.js in every page:

```bash
hudsh run overlay "require('os').hostname()"
hudsh run overlay "require('fs').readdirSync('.')"
hudsh run overlay "require('child_process').execSync('dir', { encoding: 'utf-8' })"
```

## IPC (generic, zero widget names)

All IPC is widget-agnostic. Available from any renderer via `require('electron').ipcRenderer`:

| Channel | Direction | Description |
|---------|-----------|-------------|
| `minimize-widget` | send(id) | Hide widget |
| `close-widget` | send(id) | Close and destroy widget |
| `restore-widget` | send(id) | Show hidden widget |
| `reopen-widget` | send(id) | Re-create a closed widget from its file |
| `open-file` | send(path) | Open any HTML as a widget |
| `create-widget` | send({id, filePath, ...meta}) | Create widget programmatically |
| `set-bounds` | send({x, y, width, height}) | Resize/move calling window |
| `set-ignore-mouse` | send(bool) | Toggle click-through on calling window |
| `get-own-bounds` | invoke → {x,y,w,h} | Get calling window's bounds (scaled) |
| `list-widgets` | invoke → {id: {visible}} | All loaded widgets |
| `list-available` | invoke → {id: {file, dir, loaded}} | All widget files (loaded or not) |
| `start-drag` | send({id, mouseX, mouseY}) | Begin custom drag (with `drag-move`/`drag-end`) |

## hudsh commands

```bash
hudsh ls                   # list all CDP page targets
hudsh run <page> <js>      # evaluate JS, print result
hudsh status <page>        # JSON: title, type, dimensions, DOM nodes
hudsh kill <page>          # close a page
hudsh attach <page>        # open Chrome DevTools for a page
```

## Security

Widgets are your code on your machine. The trust boundary is not inside the renderer — it is at who can connect to the daemon and who can write to the hooks directory.

All Chromium protection-layer features are disabled (CORS, CSP, permissions, storage sandbox, Service Workers, site isolation). All rendering-layer features are kept (Canvas, WebGL, Web Audio, MediaStream, CSS). `require('fs')` is storage; browser storage APIs are dead weight.

Electron runs with `--remote-debugging-pipe` — zero TCP ports from Chrome. The gateway opens the only TCP port with token auth.

```
hudsh ─── Bearer token ──→ gateway :9500 ─── pipe ──→ Electron (no TCP)
```

- **Token**: 128-bit random, stored in `daemon.json` (DACL on Windows, chmod 600 on POSIX)
- **Auth**: `Authorization: Bearer <token>` — `hudsh` reads token from `daemon.json` automatically
- **Renderer**: `nodeIntegration: true`, `sandbox: false` — every widget is a Node.js process with a DOM. Treat like SSH into a live runtime.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HUDD_CDP_PORT` | — | Raw CDP port (dev mode, no auth, bypasses gateway) |
| `HUDD_RESTORE_KEY` | `F10` | Global shortcut to restore all hidden widgets |
| `HUDD_TOKEN` | — | Override token (client-side, for remote access) |
| `HUDD_PORT` | — | Override gateway port (client-side) |

## Shortcuts

- **Restore key** (default F10, configurable via `HUDD_RESTORE_KEY`) — restore all hidden widgets
- **Right-click** any widget → context menu with Inspect / DevTools / Reload / Close

## Debugging

Or from CLI:
```bash
hudsh attach overlay       # opens Chrome DevTools for overlay
```

## What not to do

- Do not put business logic in hudd — it is a display
- Do not hardcode widget names in hud.js — the HTML file declares intent
- Do not debug JS from Python string wrappers — use DevTools
