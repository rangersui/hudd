---
name: electrond
description: Desktop overlay display daemon. Use when the task involves showing information to the user on screen — HUD overlays, status panels, live dashboards, detection boxes, or any visual widget. Drop an HTML file into the hooks directory to create a widget, or use nodesh to evaluate JS in existing pages. Use this skill whenever the user says "show me", "display", "draw", "overlay", "HUD", "widget", "dashboard", or wants visual output on their desktop.
---

# electrond

Desktop overlay daemon. Drop HTML files → widgets appear on screen.

```bash
electrond daemon     # start Electron with CDP on :9500
nodesh ls            # list pages
nodesh run overlay "document.title"   # evaluate JS
electrond stop       # stop daemon
```

electrond is a display-only daemon. It does not compute, scrape, or
make decisions. It shows things on screen.

## Two ways to display

### 1. hooks/ directory (preferred)

Write an HTML file → widget appears. Modify it → widget reloads.
Delete it → widget disappears.

```
%LOCALAPPDATA%\electrond\hooks\
```

The hooks directory is at `%LOCALAPPDATA%\electrond\hooks\` on Windows,
`~/electrond/hooks/` on other platforms. electrond watches this directory
with `fs.watch` and auto-loads any `.html` file as a widget.

```bash
# Create a widget — just write a file
cat > "$LOCALAPPDATA/electrond/hooks/cpu.html" << 'EOF'
<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
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
<div class="content">
  <div id="value">CPU: --</div>
</div>
</body></html>
EOF

# Update it — overwrite the file, widget reloads
# Delete it — rm the file, widget closes
```

Rules for hook HTML files:
- File name = widget ID (e.g., `cpu.html` → widget `hook-cpu`)
- Include `-webkit-app-region: drag` on the element you want draggable
- `background: transparent` if you want see-through
- `nodeIntegration` is on — `require('fs')`, `require('os')` work
- Widget is always-on-top, frameless, resizable, skip-taskbar

This is the preferred method because it is completely decoupled — any
process can write files. The writer does not need to know electrond
exists. electrond does not need to know who wrote the file.

### 2. nodesh run (real-time)

Evaluate JS in any page. Use for reading state, quick updates, or
when you need the return value.

```bash
# Read
nodesh run overlay "document.title"

# Write to DOM
nodesh run overlay "document.getElementById('focus-line').textContent = 'active'"

# Return structured data
nodesh run overlay "({ width: window.innerWidth, height: window.innerHeight })"
```

## Variable persistence

`window.x` persists across nodesh calls. `let` and `const` do not.

```bash
nodesh run overlay "window.counter = 0"
nodesh run overlay "window.counter += 1"
nodesh run overlay "window.counter"   # 1
```

| Syntax | Persists? | Why |
|--------|-----------|-----|
| `window.x = 1` | Yes | property on window object |
| `var x = 1` | Yes | var hoists to window in sloppy mode |
| `let x = 1` | No | block-scoped to the evaluate call |
| `const x = 1` | No | block-scoped |
| DOM changes | Yes | the DOM is the page |

## Node.js in evaluate

`nodeIntegration` is on. `require()` works in evaluate:

```bash
nodesh run overlay "require('os').hostname()"
nodesh run overlay "require('fs').readdirSync('.')"
nodesh run overlay "require('child_process').execSync('dir', { encoding: 'utf-8' })"
```

## Built-in pages

electrond starts with four pages:

| Page | Title | Purpose |
|------|-------|---------|
| overlay | `overlay` | Fullscreen transparent click-through — corner brackets, clock, detection boxes |
| status | `status` | Small status panel — connection dots, focus line |
| analyzer | `analyzer` | Screen analysis zone — resizable, reports bounds |
| browser | `browser` | Webview with navigation chrome |

## nodesh commands

```bash
nodesh ls                    # list all pages
nodesh run <page> <js>       # evaluate JS, print result
nodesh status <page>         # JSON: title, type, dimensions, DOM nodes
nodesh kill <page>           # close a page
nodesh attach <page>         # open DevTools in browser
```

## Debugging

Debug JS in DevTools, not from the outside:

```bash
nodesh attach overlay        # opens Chrome DevTools for overlay
```

Then use the Console tab to inspect, set breakpoints, profile.
Do not debug JS through Python string wrappers.

## What not to do

- Do not put business logic in electrond — it is a display
- Do not compute, scrape, or make decisions here
- Do not connect electrond to other daemons — it does not know they exist
- Do not inject stealth JS — use a stealth browser for that
- Do not debug JS from Python — use DevTools
