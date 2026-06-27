---
name: hudd
description: Desktop overlay display daemon. Use when the task involves showing information to the user on screen — HUD overlays, status panels, live dashboards, detection boxes, or any visual widget. Drop an HTML file into the hooks directory to create a widget, or use hudsh to evaluate JS in existing pages. Use this skill whenever the user says "show me", "display", "draw", "overlay", "HUD", "widget", "dashboard", or wants visual output on their desktop.
---

# hudd

Metadata-driven desktop overlay daemon. Drop HTML files → widgets appear on screen.

```bash
hudd daemon             # start Electron with CDP on :9500
hudsh ls                # list pages
hudsh run <page> "code" # evaluate JS in a page
hudd stop               # stop daemon
```

hudd is a pure runtime shell. It loads HTML files, reads their `<meta name="hudd">` tag, and creates BrowserWindows accordingly. No widget names are hardcoded — the HTML file IS the widget.

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

### Common rules for both

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

## Variable persistence

`window.x` persists across hudsh calls. `let` and `const` do not.

```bash
hudsh run overlay "window.counter = 0"
hudsh run overlay "window.counter += 1"
hudsh run overlay "window.counter"   # 1
```

| Syntax | Persists? | Why |
|--------|-----------|-----|
| `window.x = 1` | Yes | property on window object |
| `var x = 1` | Yes | var hoists to window in sloppy mode |
| `let x = 1` | No | block-scoped to the evaluate call |
| DOM changes | Yes | the DOM is the page |

## Node.js in renderer

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

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HUDD_CDP_PORT` | `9500` | Chrome DevTools Protocol port |
| `HUDD_RESTORE_KEY` | `F10` | Global shortcut to restore all hidden widgets |

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
