# electrond

Desktop overlay daemon. Electron + CDP on port 9500.

## Structure

```
electrond/
├── package.json        npm package — bin entries + dependencies
├── bin/
│   ├── electrond.js    daemon CLI (start/stop)
│   └── nodesh.js       page CLI (run/ls/kill/status/attach)
├── lib/
│   └── cdp.js          CDP HTTP + WebSocket helpers
├── hud.js              Electron main process
├── overlay.html        fullscreen transparent click-through
├── analyzer.html       screen analysis zone (resizable, reports bounds)
├── browser.html        webview with nav chrome
└── hud.html            status panel
```

## Key paths

- **daemon.json**: `%LOCALAPPDATA%\electrond\daemon.json` — PID, port, app dir
- **hooks dir**: `%LOCALAPPDATA%\electrond\hooks\` — drop HTML here → widget appears

## Architecture

electrond is a display-only daemon. It does not compute or scrape.

- **hooks/ (fs.watch)**: write HTML file → widget auto-loads. Modify → reloads. Delete → closes. Preferred for all display tasks.
- **nodesh run**: evaluate JS in a page via CDP WebSocket. Use for reading state or quick DOM updates that need a return value.
- **CDP port 9500**: `app.commandLine.appendSwitch("remote-debugging-port", "9500")` in hud.js. Configurable via `electrond daemon --port N`.

## Dev commands

```bash
npm install             # install electron + ws
npm link                # register electrond/nodesh globally
npm start               # electron . (same as electrond daemon)
electrond daemon        # start daemon (foreground, ctrl+c to stop)
electrond stop          # stop daemon
nodesh ls               # list pages
nodesh run overlay "1+1"  # evaluate JS
```

## Widget IDs

Built-in widgets: `status`, `analyzer`, `browser` (loaded from htmlFile in hud.js).
Hook widgets: `hook-<filename>` (e.g., `hooks/cpu.html` → widget ID `hook-cpu`).

## Conventions

- All HTML pages set `<title>` — nodesh finds pages by title
- Draggable: `-webkit-app-region: drag` on the header element
- Transparent: `background: transparent` + `backgroundColor: "#00000000"` in BrowserWindow
- `nodeIntegration: true` on all windows — `require('fs')` etc. work in renderer
- Hook widgets are always-on-top, frameless, resizable, skip-taskbar
- IPC stays internal (minimize/close/restore between main ↔ renderer). External control goes through CDP or hooks/.
