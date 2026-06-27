<p align="center">
  <img src="icon.svg" width="128" height="128" alt="hudd">
</p>

<h1 align="center">hudd</h1>

<p align="center"><em>HUD daemon</em> — a display server where the rendering protocol is HTML and every window is a Node.js runtime.<br>Only hydrogen.</p>

```bash
hudd daemon              # start
hudsh run "1+1"          # eval in main process (persistent, no DOM)
hudsh run <page> "1+1"   # eval in a widget page (persistent, Node.js + DOM)
hudsh ls                 # list pages
hudd stop                # stop
```

## What it is

Electron, used as a daemon — not an application. HTML files appear in a directory → windows appear on screen. Chromium renders them. Each window is a full Node.js process with a DOM. `require('fs')` and `document.getElementById` live in the same scope — there is no frontend and backend. The file is both.

```
X11/Wayland:  client connects → draws to framebuffer → compositor composites
hudd:         HTML file appears → Chromium renders it → daemon composites
```

The difference: your rendering layer is the world's best layout engine, animation engine, and text shaper — not a pixel buffer. You declare what you want, it draws. And you can `hudsh run` into any window and modify it live.

## Two runtimes

- **Main process** (`hudsh run "code"`): persistent `vm.createContext` — pure Node.js, no DOM. const/let/var all persist.
- **Widget processes** (`hudsh run <page> "code"`): Node.js + DOM in one scope. Each HTML file = one window = one concern.

Need `document`? Widget. Don't? Main. Services go in main, visual goes in widgets. Don't mix them.

## Directories

| Directory | Loaded | Watched | Trust |
|-----------|--------|---------|-------|
| App dir (alongside hud.js) | `.html` with `<meta name="hudd">` | No | Trusted |
| Hooks (`%LOCALAPPDATA%\hudd\hooks\`) | All `.html` + `.js` | Yes | Trusted |
| External (`%LOCALAPPDATA%\hudd\external\`) | Never | — | Untrusted |

Hooks is the primary workspace. Drop a file → window appears. Delete → closes. Modify → reloads.

## Widget metadata

```html
<meta name="hudd" content='{"width":300,"height":200,"position":"center","resizable":true}'>
```

All fields optional. Undeclared → defaults (transparent, frameless, always-on-top, 360×260). `type: "overlay"` → fullscreen click-through. Every window property configurable: `transparent`, `frame`, `hasShadow`, `alwaysOnTop`, `level`, `focusable`, `movable`, `clickThrough`, `skipTaskbar`, `roundedCorners`, `backgroundColor`, `minWidth`, `minHeight`, `pad`, `inset`, `windowType`.

## Security

Widgets are native applications, not browser tabs. Every line is your code, or a package you chose to trust. The browser's security model (CORS, CSP, sandbox, permissions) exists to protect against hostile third-party content in the renderer — that problem doesn't exist here. Those features are off. Rendering features (Canvas, WebGL, CSS, `<video>`) stay.

The trust boundary is at who can connect to the daemon and who can write to the hooks directory — not inside the renderer.

```
hudsh ─── Bearer token ──→ gateway :9500 ─── pipe ──→ Electron (no TCP)
```

`nodeIntegration: true`, `sandbox: false` — treat like SSH into a Node.js + DOM runtime. You are responsible for what runs inside. Don't `<script src="https://...">` from external CDNs. If you want to browse the web, use a real browser — hudd is a runtime for your own code.

## hudsh

```
hudsh run <js>             eval in main process
hudsh run <page> <js>      eval in a page
hudsh ls                   list pages
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

The hooks directory is your environment — copy it and you copy your toolset.

**Share widgets** — send HTML files. Recipient drops them in hooks dir.

**Share an environment** — git repo with your hooks + `package.json` depending on hudd.

**Package as standalone app** — hudd is Electron. `npx electron-builder` → `.exe` / `.dmg` / `.AppImage`. No Node.js needed on target machine.

## License

MIT
