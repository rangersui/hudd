# electrond

Desktop overlay daemon. Drop HTML files → widgets appear on screen.

```bash
npm install -g electrond
electrond daemon          # start Electron + CDP on :9500
nodesh ls                 # list pages
nodesh run overlay "1+1"  # evaluate JS in a page
electrond stop            # stop
```

## How it works

electrond runs Electron as a background daemon with CDP (Chrome DevTools Protocol) exposed on port 9500. Two ways to display things:

### 1. hooks/ directory (preferred)

Write an HTML file to the hooks directory → widget auto-appears. Modify → reloads. Delete → closes.

```
Windows:  %LOCALAPPDATA%\electrond\hooks\
Other:    ~/electrond/hooks/
```

```bash
echo '<div style="color:#0f0; font:24px monospace; padding:20px; background:rgba(0,0,0,0.9); -webkit-app-region:drag">hello</div>' > "$LOCALAPPDATA/electrond/hooks/hello.html"
```

Any process can write files. The writer does not need to know electrond exists.

### 2. nodesh (real-time)

Evaluate JS in any page via CDP. Use when you need the return value.

```bash
nodesh run overlay "document.title"
nodesh run overlay "window.data = {cpu: 45}"
nodesh run overlay "require('os').hostname()"
```

## nodesh commands

```
nodesh ls                   list all pages
nodesh run <page> <js>      evaluate JS, print result
nodesh status <page>        JSON info (title, dimensions, DOM nodes)
nodesh kill <page>          close a page
nodesh attach <page>        open DevTools in browser
```

## Built-in pages

| Page | Purpose |
|------|---------|
| overlay | Fullscreen transparent click-through — clock, detection boxes |
| status | Status panel — connection dots, focus line |
| analyzer | Screen analysis zone — resizable, reports bounds |
| browser | Webview with navigation chrome |

## Hook HTML rules

- File name = widget ID (`cpu.html` → `hook-cpu`)
- `-webkit-app-region: drag` on the draggable element
- `background: transparent` for see-through
- `nodeIntegration` is on — `require('fs')` works
- Widgets are always-on-top, frameless, resizable

## Variable persistence

```bash
nodesh run overlay "window.x = 42"    # persists
nodesh run overlay "window.x"         # 42
nodesh run overlay "let y = 1"        # does NOT persist (block-scoped)
```

## Install

```bash
git clone <repo> && cd electrond
npm install
npm link    # registers electrond + nodesh globally
```

## License

MIT
