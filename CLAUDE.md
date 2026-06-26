# hudd

Desktop overlay daemon. Electron + CDP on port 9500.

## Structure

```
hudd/
├── package.json        npm package — bin entries + dependencies
├── bin/
│   ├── hudd.js    daemon CLI (start/stop)
│   └── hudsh.js       page CLI (run/ls/kill/status/attach)
├── lib/
│   └── cdp.js          CDP HTTP + WebSocket helpers
├── hud.js              Electron main process
├── overlay.html        fullscreen transparent click-through
├── analyzer.html       screen analysis zone (resizable, reports bounds)
├── browser.html        webview with nav chrome
└── hud.html            status panel
```

## Key paths

- **daemon.json**: `%LOCALAPPDATA%\hudd\daemon.json` — PID, port, app dir
- **hooks dir**: `%LOCALAPPDATA%\hudd\hooks\` — drop HTML here → widget appears

## Architecture

hudd is a display-only daemon. It does not compute or scrape.

- **hooks/ (fs.watch)**: write HTML file → widget auto-loads. Modify → reloads. Delete → closes. Preferred for all display tasks.
- **hudsh run**: evaluate JS in a page via CDP WebSocket. Use for reading state or quick DOM updates that need a return value.
- **CDP port 9500**: `app.commandLine.appendSwitch("remote-debugging-port", "9500")` in hud.js. Configurable via `hudd daemon --port N`.

## Dev commands

```bash
npm install             # install electron + ws
npm link                # register hudd/hudsh globally
npm start               # electron . (same as hudd daemon)
hudd daemon        # start daemon (foreground, ctrl+c to stop)
hudd stop          # stop daemon
hudsh ls               # list pages
hudsh run overlay "1+1"  # evaluate JS
```

## Widget IDs

Built-in widgets: `status`, `analyzer`, `browser` (loaded from htmlFile in hud.js).
Hook widgets: `hook-<filename>` (e.g., `hooks/cpu.html` → widget ID `hook-cpu`).

## Conventions

- All HTML pages set `<title>` — hudsh finds pages by title
- Draggable: `-webkit-app-region: drag` on the header element
- Transparent: `background: transparent` + `backgroundColor: "#00000000"` in BrowserWindow
- `nodeIntegration: true` on all windows — `require('fs')` etc. work in renderer
- Hook widgets are always-on-top, frameless, resizable, skip-taskbar
- IPC stays internal (minimize/close/restore between main ↔ renderer). External control goes through CDP or hooks/.
