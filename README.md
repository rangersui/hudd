<p align="center">
  <img src="icon.svg" width="128" height="128" alt="hudd">
</p>

<h1 align="center">hudd</h1>

<p align="center">A HUD daemon that also acts as a declarative native application framework.<br>One HTML file = one native app. No build, no config.</p>

```bash
hudd daemon              # start with auth gateway on :9500
hudsh run "1+1"          # evaluate JS in main process (persistent, no DOM)
hudsh run <page> "1+1"   # evaluate JS in a widget page
hudsh ls                 # list pages
hudd stop                # stop
```

## How it works

hudd is a pure runtime shell — mechanism only, zero policy. It runs Electron with CDP and loads HTML files as BrowserWindows. Each HTML file declares its own layout and behavior via a `<meta>` tag. All window properties are configurable; undeclared fields fall through to defaults.

### 1. App directory (alongside hud.js)

HTML files with `<meta name="hudd">` are loaded at boot. This is where core widgets live (overlay, analyzer, status, etc.). Not watched — restart to pick up changes.

### 2. Hooks directory (hot-reload)

```
Windows:  %LOCALAPPDATA%\hudd\hooks\
Other:    ~/hudd/hooks/
```

All `.html` files loaded (meta optional). `.js` files `require()`'d in main process. Watched with `fs.watch` — drop a file → widget appears, delete → closes.

### 3. External directory (untrusted)

```
Windows:  %LOCALAPPDATA%\hudd\external\
Other:    ~/hudd/external/
```

Created at boot, never loaded. Visible in `list-available` but inert. Putting a file here is a deliberate act — the filesystem is the permission model.

### 4. hudsh (real-time)

Evaluate JS in any page via CDP:

```bash
hudsh run overlay "document.title"
hudsh run overlay "require('os').hostname()"
```

### 5. Open any HTML file

```bash
electron hud.js /path/to/file.html   # single-instance, forwards to running daemon
```

## Widget metadata

Widgets declare layout and behavior in `<head>`:

```html
<meta name="hudd" content='{"width":300,"height":200,"position":"center","resizable":true}'>
```

All fields optional. Common fields: `width`, `height`, `position`, `resizable`, `type`, `x`, `y`.

Every window property is configurable via meta: `transparent`, `frame`, `hasShadow`, `skipTaskbar`, `alwaysOnTop`, `level`, `focusable`, `movable`, `clickThrough`, `roundedCorners`, `backgroundColor`, `minWidth`, `minHeight`, `pad`, `inset`, `windowType`. Undeclared fields fall through to runtime defaults. `type: "overlay"` layers overlay-specific defaults (click-through, screen-saver level, unfocusable).

- `position`: `top-left`, `top-right`, `bottom-left`, `bottom-right`, `bottom-center`, `center`
- No meta in hooks dir → defaults applied
- No meta in app dir → file skipped

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HUDD_CDP_PORT` | — | Raw CDP port (dev mode, no auth, bypasses gateway) |
| `HUDD_RESTORE_KEY` | `F10` | Restore-all shortcut |
| `HUDD_TOKEN` | — | Override token (client-side, for remote access) |
| `HUDD_PORT` | — | Override gateway port (client-side) |

## Persistent runtime

Two runtimes, one daemon:

- **Main process** (`hudsh run "code"`): persistent `vm.createContext` — no DOM, pure Node.js. const/let/var all persist across calls.
- **Widget processes** (`hudsh run <page> "code"`): each widget is a renderer with Node.js + DOM. Variables persist on `window.*`.

`hudsh run` is a function call into a live process, not a fresh script.

## Security

Widgets are your code on your machine. Trust boundary is at the daemon, not inside the renderer.

All Chromium protection-layer features are off (CORS, CSP, permissions, storage sandbox, Service Workers). Rendering-layer features stay (Canvas, WebGL, Web Audio, MediaStream, CSS). `require('fs')` is storage; `navigator.mediaDevices.getUserMedia()` is the camera. No IPC glue — the renderer IS the runtime.

```
hudsh ─── Bearer token ──→ gateway :9500 ─── pipe ──→ Electron (no TCP)
```

- **Token**: 128-bit random, `daemon.json` (DACL on Windows, chmod 600 on POSIX)
- **Auth**: `hudsh` reads token from `daemon.json` automatically
- **Renderer**: `nodeIntegration: true`, `sandbox: false` — treat like SSH into a Node.js + DOM runtime

## Renderer environment

- `nodeIntegration: true` — `require('fs')`, `require('os')` work
- `contextIsolation: false`, `sandbox: false`
- `-webkit-app-region: drag` for draggable headers
- All window chrome (transparent, frame, shadow, etc.) configurable via meta
- Right-click any widget → DevTools
- Restore key (default F10) → restore all hidden widgets
- Daemon stays alive with zero widgets

## hudsh commands

```
hudsh ls                   list all pages
hudsh run <js>             evaluate JS in main process
hudsh run <page> <js>      evaluate JS in a page
hudsh status <page>        JSON info
hudsh kill <page>          close a page
hudsh attach <page>        open DevTools
```

## Install

```bash
git clone https://github.com/rangersui/hudd.git && cd hudd
npm install
npm link    # registers hudd + hudsh globally
```

## Distribution

The hooks directory is your environment. Three ways to share it:

**Share widgets** — send HTML files. Recipient drops them in their hooks dir.

**Share an environment** — git repo with your widgets + `package.json` that depends on hudd. `git clone && npm install && hudd daemon`.

**Package as standalone app** — hudd is Electron. Put your widgets in the app directory (with `<meta name="hudd">`), run `npx electron-builder`. Output: `.exe` / `.dmg` / `.AppImage`. No Node.js, no hudd install needed on target machine.

## License

MIT
