---
name: hudd
description: A HUD daemon that also acts as a declarative native application framework. One HTML file = one native app with full Node.js + DOM access. Use this skill whenever the user wants a desktop widget, overlay, dashboard, system monitor, file browser, log viewer, database inspector, any visual tool, a background service, or a packaged desktop application. Also use when the user says "show me", "display", "draw on screen", "overlay", "HUD", "widget", "native app", or wants to build a local GUI app. The output is one HTML file — drop it in a folder, it runs. No build step, no dependencies.
---

# hudd

A display server where the rendering protocol is HTML and every window is a Node.js runtime.

```
HTML file appears in directory  →  Chromium renders it  →  window on screen
hudsh run page "code"           →  eval into live process  →  window changes
```

## Mental model

hudd is a daemon. HTML files are its clients. The filesystem is the connection protocol.

Traditional display servers (X11, Wayland) give you a framebuffer and say "draw your own pixels." hudd gives you Chromium — the world's most advanced layout engine, text shaper, animation engine, and compositor — and says "declare what you want." You write CSS, not pixel math. You write `<canvas>`, not `glBegin`.

Every window is also a full Node.js process. `require('fs')` and `document.getElementById` live in the same scope. There is no frontend and backend — the file is both.

```html
<script>
  // One scope. Both lines work.
  const files = require('fs').readdirSync('.');       // Node.js
  document.getElementById('list').textContent = files; // DOM
</script>
```

The runtime is persistent — variables, connections, servers, timers survive across `hudsh run` calls. The filesystem is deployment — write a file, app appears; delete, gone. No build, no restart.

## Choosing a runtime

One daemon, two runtimes. Pick by whether the task needs a DOM:

| | Main process | Widget process |
|---|---|---|
| Entry | `hudsh run "code"` | `hudsh run <page> "code"` |
| Has DOM | No | Yes |
| Lifecycle | Daemon lifetime | Widget lifetime (file exists → alive) |
| Scope | One shared context | One context per HTML file |
| Use for | Services, shared state, data processing, automation | Visual tools — one file, one window, one concern |

**Main process** — pure Node.js, no window. `const/let/var` all persist. Use for anything that doesn't need to render: HTTP servers, database connections, file watchers, scheduled tasks, shared state. Equivalent to a persistent `node` REPL.

**Widget process** — Node.js + DOM in one scope. One HTML file = one window = one concern. A CPU monitor is one file. A log viewer is one file. A database inspector is one file. Split by concern, keep each small. Widgets coordinate via IPC (`broadcast`, `list-widgets`) or shared state in main.

### Anti-patterns

**Don't mix server and client in one widget.** `nodeIntegration: true` liberates the client — a widget can `require('fs')`, spawn processes, access hardware directly. It's a native app, not a browser tab. But `http.createServer()` in a widget ties a server's lifecycle to a window. Services go in main, visual goes in widgets.

**Don't re-create the browser split.** The widget already has `require()`. If it needs data, it reads directly — `require('fs')`, `require('better-sqlite3')`, `require('child_process')`. Do NOT start an HTTP server in main and then `fetch()` from a widget. That's re-introducing the exact client-server separation that hudd eliminates.

```
✗  main: http.createServer(handler)  →  widget: fetch('http://localhost:3000/data')
✓  widget: require('better-sqlite3')('app.db').prepare('SELECT ...').all()
```

When in doubt: if you need `document`, it's a widget. If you don't, it's main.

## Anatomy of a widget

### Meta tag — window properties

```html
<meta name="hudd" content='{"width":400,"height":300,"position":"bottom-right","resizable":true}'>
```

Single-quote wrapper required (JSON uses `"` internally). All fields optional — undeclared fields fall through to defaults (transparent, frameless, always-on-top, 360×260).

### Draggable region

Frameless windows need a drag handle. Add `-webkit-app-region: drag` on the element you want draggable. Interactive elements inside it need `-webkit-app-region: no-drag`.

### Everything else

There is no prescribed structure. Use any HTML, CSS, Canvas, SVG, WebGL, video, audio. Use any Node.js module. The widget decides its own layout, behavior, and architecture.

### Example — CPU monitor with live chart

Node.js (`os.cpus()`) and DOM (Canvas) in one file:

```html
<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="hudd" content='{"width":280,"height":150,"position":"top-right","resizable":true}'>
<title>cpu</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: rgba(10, 10, 25, 0.9); color: #ccc; font-family: monospace; }
  header { padding: 6px 10px; font-size: 11px; -webkit-app-region: drag; }
  #pct { font-size: 22px; padding: 0 10px; font-weight: bold; }
  canvas { width: 100%; height: 50px; }
</style>
</head>
<body>
<header id="host"></header>
<div id="pct">—</div>
<canvas id="c" height="50"></canvas>
<script>
  const os = require('os');
  const ctx = document.getElementById('c').getContext('2d');
  const hist = [];
  let pIdle = 0, pTotal = 0;
  document.getElementById('host').textContent = os.hostname();
  setInterval(() => {
    const cpus = os.cpus();
    const idle = cpus.reduce((a,c) => a + c.times.idle, 0);
    const total = cpus.reduce((a,c) => a + Object.values(c.times).reduce((s,v) => s+v, 0), 0);
    const pct = pTotal ? Math.round(100 - (idle-pIdle)/(total-pTotal)*100) : 0;
    pIdle = idle; pTotal = total;
    document.getElementById('pct').textContent = `CPU ${pct}%`;
    hist.push(pct); if (hist.length > 280) hist.shift();
    ctx.fillStyle = 'rgba(10,10,25,0.9)'; ctx.fillRect(0,0,280,50);
    ctx.strokeStyle = '#f5a623'; ctx.beginPath();
    hist.forEach((v,i) => { const y = 50-v/100*50; i?ctx.lineTo(i,y):ctx.moveTo(i,y); });
    ctx.stroke();
  }, 1000);
</script>
</body></html>
```

Drop in hooks dir → live CPU widget on desktop.

## Deploying widgets

### Hooks directory (hot-reload, recommended)

```
Windows:  %LOCALAPPDATA%\hudd\hooks\
Other:    ~/hudd/hooks/
```

Write a file → widget appears. Modify → reloads. Delete → closes. Widget ID = `hook-<filename>`.

### App directory (alongside hud.js)

Core widgets with `<meta name="hudd">`. Scanned once at boot, not watched. Widget ID = `meta.id` or filename.

### External directory (untrusted, inert)

```
Windows:  %LOCALAPPDATA%\hudd\external\
Other:    ~/hudd/external/
```

Created at boot but never loaded. Visible in `list-available` but inert. Someone gives you an `.html` you don't trust — put it here. You read the code, decide it's fine — move it to hooks. That's code review + deploy, same as deciding to `npm install` a package.

### Open any HTML file directly

```bash
electron hud.js /path/to/file.html   # forwards to running daemon (single-instance)
```

## Meta tag reference

All fields optional. Content must use single-quote wrapper: `content='...'`.

### Layout

| Field | Default | Description |
|-------|---------|-------------|
| `id` | filename | Widget ID |
| `type` | normal | `"overlay"` → fullscreen click-through |
| `width`, `height` | 360×260 | Window size px (overlay: fullscreen) |
| `position` | cascade | `top-left` `top-right` `bottom-left` `bottom-right` `bottom-center` `center` |
| `x`, `y` | from position | Exact pixel position (overrides position) |
| `pad` | 30 | Edge padding for position calculation |
| `inset` | 1 (overlay) | Overlay edge inset for taskbar compat |

### Window chrome

| Field | Default | Overlay | Description |
|-------|---------|---------|-------------|
| `transparent` | true | true | Transparent background |
| `frame` | false | false | Show window frame |
| `hasShadow` | false | false | Window shadow |
| `roundedCorners` | false | false | Rounded corners |
| `backgroundColor` | `#00000000` | — | Background color |
| `windowType` | `toolbar` | — | Electron window type |
| `minWidth`, `minHeight` | 200×120 | — | Min size when resizable |

### Behavior

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

## What's available in a widget

### Node.js (full access)

All built-in modules work:

```javascript
const fs = require('fs');                    // filesystem
const os = require('os');                    // system info
const { exec, spawn } = require('child_process');  // run commands
const path = require('path');                // path manipulation
const http = require('http');                // HTTP server/client
const net = require('net');                  // TCP sockets
const crypto = require('crypto');            // cryptography
```

npm packages work too — `require()` resolves from the widget file's directory upward. For hooks widgets, install packages in the hudd data directory (the parent of hooks/):

```bash
# Windows
cd %LOCALAPPDATA%\hudd && npm install better-sqlite3

# POSIX
cd ~/hudd && npm install better-sqlite3
```

Then `require('better-sqlite3')` works in any hooks widget. App dir widgets resolve from hudd's own `node_modules/`.

### DOM (full browser engine)

Canvas 2D/WebGL, SVG, CSS animations, `<video>`/`<audio>`, MediaStream (`getUserMedia`), ResizeObserver, IntersectionObserver, requestAnimationFrame — everything the rendering engine provides.

### IPC (between widgets)

Available via `require('electron').ipcRenderer`:

| Channel | Direction | Description |
|---------|-----------|-------------|
| `minimize-widget` | send(id) | Hide widget |
| `close-widget` | send(id) | Close and destroy widget |
| `restore-widget` | send(id) | Show hidden widget |
| `open-file` | send(path) | Open any HTML as a widget |
| `set-bounds` | send({x, y, width, height}) | Resize/move calling window |
| `set-ignore-mouse` | send(bool) | Toggle click-through |
| `get-own-bounds` | invoke → {x,y,w,h} | Get calling window's bounds |
| `list-widgets` | invoke → {id: {visible}} | All loaded widgets |
| `list-available` | invoke → {id: {file, dir, loaded}} | All widget files |

## hudsh — eval into live processes

```bash
# Main process — no DOM, pure Node.js, const/let/var all persist
hudsh run "const x = 42"          # persists in vm context
hudsh run "x + 1"                 # 43
hudsh run "require('os').hostname()"

# Widget process — Node.js + DOM, variables on window.*
hudsh run work "window.x = 42"    # persists in renderer
hudsh run work "window.x + 1"     # 43

hudsh ls                          # list all widgets
hudsh status <page>               # JSON info
hudsh kill <page>                 # close widget
hudsh attach <page>               # open DevTools
```

No page argument = main process. With page argument = that widget's renderer. Both are function calls into live processes, not fresh scripts.

## Daemon

```bash
hudd daemon          # start with auth gateway on :9500
hudd stop            # stop
```

The daemon stays alive with zero widgets. Widgets arrive via hooks dir, CLI, or IPC.

## Security

Widgets are your code on your machine. You don't `<script src="https://random-cdn.js">` in a hudd widget, just like you don't `#include` a random `.h` in a Qt project. Every line is yours, or a package you chose to trust. The browser's security model solves a problem that doesn't exist here.

The trust boundary is at who can connect to the daemon and who can write to the hooks directory — not inside the renderer.

All Chromium protection-layer features are off (CORS, CSP, permissions, storage sandbox, Service Workers). Rendering-layer features stay (Canvas, WebGL, Web Audio, MediaStream, CSS). `require('fs')` is storage; `getUserMedia()` is the camera.

```
hudsh ─── Bearer token ──→ gateway :9500 ─── pipe ──→ Electron (no TCP)
```

- **Token**: 128-bit random, `daemon.json` (DACL on Windows, chmod 600 on POSIX)
- **Renderer**: `nodeIntegration: true`, `sandbox: false` — treat like SSH into a Node.js + DOM runtime

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HUDD_CDP_PORT` | — | Raw CDP port (dev mode, no auth) |
| `HUDD_RESTORE_KEY` | `F10` | Restore-all shortcut |
| `HUDD_TOKEN` | — | Override token (client-side) |
| `HUDD_PORT` | — | Override gateway port (client-side) |

## Distribution

The hooks directory is your environment — copy it and you copy your toolset.

**Share widgets** — send the HTML files. Recipient drops them in hooks dir, they appear.

**Share an environment** — git repo with your hooks:

```
my-env/
├── package.json        ← { "dependencies": { "@rangersui/hudd": "..." } }
└── hooks/
    ├── dashboard.html
    ├── monitor.html
    └── server.js       ← main process script
```

`git clone && npm install` — symlink or copy `hooks/` to `%LOCALAPPDATA%\hudd\hooks\` — `hudd daemon`

**Package as standalone app** — hudd is Electron. Put widgets in the app directory (with `<meta name="hudd">`), run `npx electron-builder`. Output: `.exe` / `.dmg` / `.AppImage` — no Node.js or hudd needed on target machine. Your HTML files become a native desktop application.

## Gotchas

- **Native npm modules** (better-sqlite3, sharp, etc.) are compiled against a specific Node ABI. Electron bundles its own Node version, so native modules need `electron-rebuild` or `@electron/rebuild` to match. Pure JS packages (ws, lodash, etc.) work without rebuild.
- **`localStorage` / `sessionStorage` / IndexedDB are disabled.** `require('fs')` is storage. `require('better-sqlite3')` is the database. If you try browser storage APIs, they silently fail.
- **Meta JSON parse error** → `readMeta` returns `null` → widget skipped in app dir, loaded with defaults in hooks dir. No error message — check hud.log.
- **`require()` of missing module** → renderer throws, widget shows blank. Not a crash — the process survives, other widgets unaffected. Check DevTools console (right-click → DevTools).

## Design principles

- hudd is a display server. HTML is the rendering protocol. The filesystem is the connection protocol.
- Every window is a Node.js runtime. `require()` and `document` in the same scope, no bridge.
- Meta tag declares window intent. Undeclared fields fall through to defaults.
- Hooks directory is the deployment target. Filesystem is the package manager.
- hud.js is a pure runtime shell — mechanism only, zero policy. The widget decides everything about itself.
