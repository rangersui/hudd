# hudd

Metadata-driven desktop overlay daemon. Drop HTML files → widgets appear on screen.

```bash
hudd daemon              # start Electron + CDP on :9500
hudsh ls                 # list pages
hudsh run <page> "1+1"   # evaluate JS in a page
hudd stop                # stop
```

## How it works

hudd is a pure runtime shell. It runs Electron with CDP on port 9500 and loads HTML files as BrowserWindows. Each HTML file declares its own layout via a `<meta>` tag — hudd has zero hardcoded widgets.

### 1. App directory (alongside hud.js)

HTML files with `<meta name="hudd">` are loaded at boot. This is where core widgets live (overlay, analyzer, status, etc.). Not watched — restart to pick up changes.

### 2. Hooks directory (hot-reload)

```
Windows:  %LOCALAPPDATA%\hudd\hooks\
Other:    ~/hudd/hooks/
```

All `.html` files loaded (meta optional). `.js` files `require()`'d in main process. Watched with `fs.watch` — drop a file → widget appears, delete → closes.

### 3. hudsh (real-time)

Evaluate JS in any page via CDP:

```bash
hudsh run overlay "document.title"
hudsh run overlay "require('os').hostname()"
```

### 4. Open any HTML file

```bash
electron hud.js /path/to/file.html   # single-instance, forwards to running daemon
```

## Widget metadata

Widgets declare layout in `<head>`:

```html
<meta name="hudd" content='{"width":300,"height":200,"position":"center","resizable":true}'>
```

- `position`: `top-left`, `top-right`, `bottom-left`, `bottom-right`, `bottom-center`, `center`
- `type: "overlay"` → fullscreen click-through
- No meta in hooks dir → defaults applied
- No meta in app dir → file skipped

## Renderer environment

- `nodeIntegration: true` — `require('fs')`, `require('os')` work
- `contextIsolation: false`, `sandbox: false`
- `-webkit-app-region: drag` for draggable headers
- `background: transparent` + always-on-top + frameless
- Right-click any widget → DevTools
- F10 → restore all hidden widgets

## hudsh commands

```
hudsh ls                   list all pages
hudsh run <page> <js>      evaluate JS, print result
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

## License

MIT
