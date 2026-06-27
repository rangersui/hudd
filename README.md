<p align="center">
  <img src="icon.svg" width="128" height="128" alt="hudd">
</p>

<h1 align="center">hudd</h1>

<p align="center"><em>HUD daemon</em> — a display server where the rendering protocol is HTML and every window is a Node.js runtime.<br>Only hydrogen.</p>

```
Drop an HTML file into hooks/.
A transparent always-on-top window appears.
The file is a Node.js runtime with a DOM.

Drop a JS file into hooks/.
It runs in the main process as a background service.

Delete the file. The window closes. The service stops.
Modify the file. It reloads.

hudsh run "code"          eval in main process (persistent, no DOM)
hudsh run <page> "code"   eval in a live window (persistent, Node.js + DOM)
```

## What it is

Electron, used as a daemon — not an application. Chromium is the rendering engine. The filesystem is the connection protocol. `require('fs')` and `document.getElementById` live in the same scope. There is no frontend and backend.

```
X11/Wayland:  client connects → draws to framebuffer → compositor composites
hudd:         HTML file appears → Chromium renders it → daemon composites
```

hudd is a compositor, not an application. It doesn't know what runs on top of it — an editor, a terminal, a dashboard, a monitor are each one HTML file in the same directory. Unlike a traditional compositor, hudd is also a runtime (`hudsh run "code"` — persistent, stateful) and a shell (`hudsh run <page> "code"` — reach into any live window from outside).

## Two runtimes

- **Main process** (`hudsh run "code"`): persistent `vm.createContext` — pure Node.js, no DOM. const/let/var all persist.
- **Widget processes** (`hudsh run <page> "code"`): Node.js + DOM in one scope. Each HTML file = one window = one concern.

Need `document`? Widget. Don't? Main. Services go in main, visual goes in widgets.

## Directories

| Directory | Loaded | Watched | Trust |
|-----------|--------|---------|-------|
| App dir (alongside hud.js) | `.html` with `<meta name="hudd">` | No | Trusted |
| Hooks (`%LOCALAPPDATA%\hudd\hooks\`) | All `.html` + `.js` | Yes | Trusted |
| External (`%LOCALAPPDATA%\hudd\external\`) | Never | — | Untrusted |

## Widget metadata

```html
<meta name="hudd" content='{"width":300,"height":200,"position":"center","resizable":true}'>
```

All fields optional. Undeclared → defaults (transparent, frameless, always-on-top, 360×260). `type: "overlay"` → fullscreen click-through.

## Security

Widgets are native applications, not browser tabs. The browser's security model (CORS, CSP, sandbox, permissions) exists to protect against hostile third-party content — that problem doesn't exist here. Those features are off. Rendering features (Canvas, WebGL, CSS, `<video>`) stay.

The trust boundary is at who can connect to the daemon and who can write to the hooks directory — not inside the renderer.

```
hudsh ─── Bearer token ──→ gateway :9500 ─── pipe ──→ Electron (no TCP)
```

`nodeIntegration: true`, `sandbox: false` — treat like SSH into a Node.js + DOM runtime. You are responsible for what runs inside. If you want to browse the web, use a real browser — hudd is a runtime for your own code.

**When not to use hudd**: when you need to load untrusted external content. A browser protects you from code you didn't choose to trust. hudd runs code you did.

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
