# hudd

Desktop overlay daemon. Drop HTML files → widgets appear on screen.

```bash
npm install -g hudd
hudd daemon          # start Electron + CDP on :9500
hudsh ls                 # list pages
hudsh run overlay "1+1"  # evaluate JS in a page
hudd stop            # stop
```

## How it works

hudd runs Electron as a background daemon with CDP (Chrome DevTools Protocol) exposed on port 9500. Two ways to display things:

### 1. hooks/ directory (preferred)

Write an HTML file to the hooks directory → widget auto-appears. Modify → reloads. Delete → closes.

```
Windows:  %LOCALAPPDATA%\hudd\hooks\
Other:    ~/hudd/hooks/
```

```bash
echo '<div style="color:#0f0; font:24px monospace; padding:20px; background:rgba(0,0,0,0.9); -webkit-app-region:drag">hello</div>' > "$LOCALAPPDATA/hudd/hooks/hello.html"
```

Any process can write files. The writer does not need to know hudd exists.

### 2. hudsh (real-time)

Evaluate JS in any page via CDP. Use when you need the return value.

```bash
hudsh run overlay "document.title"
hudsh run overlay "window.data = {cpu: 45}"
hudsh run overlay "require('os').hostname()"
```

## hudsh commands

```
hudsh ls                   list all pages
hudsh run <page> <js>      evaluate JS, print result
hudsh status <page>        JSON info (title, dimensions, DOM nodes)
hudsh kill <page>          close a page
hudsh attach <page>        open DevTools in browser
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
hudsh run overlay "window.x = 42"    # persists
hudsh run overlay "window.x"         # 42
hudsh run overlay "let y = 1"        # does NOT persist (block-scoped)
```

## Install

```bash
git clone <repo> && cd hudd
npm install
npm link    # registers hudd + hudsh globally
```

## License

MIT
