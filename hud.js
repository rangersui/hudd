const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

app.commandLine.appendSwitch("remote-debugging-port", "9500");
app.disableHardwareAcceleration();

let overlayWin = null;
const widgets = {};  // id -> BrowserWindow

// ════════════════════════════════════════════
// OVERLAY — fullscreen transparent click-through
// ════════════════════════════════════════════

function createOverlay() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  overlayWin = new BrowserWindow({
    // inset 1px so Windows can still detect screen-edge hover (taskbar auto-hide)
    x: x + 1, y: y + 1,
    width: width - 2, height: height - 2,
    transparent: true,
    frame: false,
    show: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    thickFrame: false,
    type: "toolbar",
    backgroundColor: "#00000000",
    roundedCorners: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  overlayWin.setSkipTaskbar(true);
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.loadFile(path.join(__dirname, "overlay.html"));
  overlayWin.once("ready-to-show", () => overlayWin.showInactive());
}

// ════════════════════════════════════════════
// WIDGETS — small interactive windows
// ════════════════════════════════════════════

function createWidget(id, opts = {}) {
  if (widgets[id]) return widgets[id];

  const w = opts.width || 340;
  const h = opts.height || 200;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: w, height: h,
    x: opts.x ?? (sw - w - 30),
    y: opts.y ?? (sh - h - 30),
    transparent: true,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: !!opts.resizable,
    hasShadow: false,
    thickFrame: !!opts.resizable,
    type: "toolbar",
    backgroundColor: "#00000000",
    roundedCorners: false,
    minWidth: opts.resizable ? 200 : undefined,
    minHeight: opts.resizable ? 120 : undefined,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: !!opts.webviewTag,
    },
  });

  win.setSkipTaskbar(true);
  win.setAlwaysOnTop(true, "pop-up-menu");
  win.loadFile(path.join(__dirname, opts.htmlFile || "hud.html"), { query: { id } });
  widgets[id] = win;
  win.once("ready-to-show", () => win.showInactive());
  win.on("closed", () => { delete widgets[id]; });

  // analyzer: notify renderer when window moves or resizes
  if (id === "analyzer") {
    win.on("moved", () => {
      if (!win.isDestroyed()) win.webContents.send("position-changed");
    });
    win.on("resized", () => {
      if (!win.isDestroyed()) win.webContents.send("position-changed");
    });
  }

  return win;
}

// ════════════════════════════════════════════
// APP READY
// ════════════════════════════════════════════

app.whenReady().then(() => {
  createOverlay();
  createWidget("status", { width: 340, height: 200 });
  createWidget("analyzer", {
    width: 400, height: 300,
    x: 100, y: 200,
    htmlFile: "analyzer.html",
    resizable: true,
  });

  createWidget("browser", {
    width: 900, height: 620,
    x: 50, y: 30,
    htmlFile: "browser.html",
    resizable: true,
    webviewTag: true,
  });

  initHooks();

  // F10 = restore all hidden widgets
  globalShortcut.register("F10", () => {
    Object.entries(widgets).forEach(([id, win]) => {
      if (!win.isDestroyed() && !win.isVisible()) {
        win.show();
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("widget-restored", id);
        }
      }
    });
  });
});

// ════════════════════════════════════════════
// IPC — drag
// ════════════════════════════════════════════

ipcMain.on("start-drag", (e, { id, mouseX, mouseY }) => {
  const win = widgets[id];
  if (!win) return;
  const [wx, wy] = win.getPosition();
  const offX = mouseX, offY = mouseY;

  const move = (_e2, { x, y }) => {
    win.setPosition(wx + x - offX, wy + y - offY);
  };
  const up = () => {
    ipcMain.removeListener("drag-move", move);
    ipcMain.removeListener("drag-end", up);
  };
  ipcMain.on("drag-move", move);
  ipcMain.on("drag-end", up);
});

// ════════════════════════════════════════════
// IPC — analyzer bounds (returns physical pixels for mss)
// ════════════════════════════════════════════

ipcMain.handle("get-analyzer-bounds", () => {
  const win = widgets["analyzer"];
  if (!win) return null;
  const bounds = win.getBounds();
  const sf = screen.getPrimaryDisplay().scaleFactor;
  return {
    x: Math.round(bounds.x * sf),
    y: Math.round(bounds.y * sf),
    w: Math.round(bounds.width * sf),
    h: Math.round(bounds.height * sf),
  };
});

// ════════════════════════════════════════════
// IPC — minimize / close / restore
// ════════════════════════════════════════════

ipcMain.on("minimize-widget", (_e, id) => {
  if (widgets[id]) {
    widgets[id].hide();
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send("widget-minimized", id);
    }
  }
});

ipcMain.on("close-widget", (_e, id) => {
  if (widgets[id]) {
    widgets[id].close();
    delete widgets[id];
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send("widget-closed", id);
    }
  }
});

ipcMain.on("restore-widget", (_e, id) => {
  if (widgets[id]) {
    widgets[id].show();
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send("widget-restored", id);
    }
  }
});

ipcMain.on("create-widget", (_e, data) => {
  createWidget(data.id, data);
});

// ════════════════════════════════════════════
// HOOKS — fs.watch auto-loads HTML as widgets
// ════════════════════════════════════════════

const LOCALAPPDATA = process.env.LOCALAPPDATA || os.homedir();
const HOOKS_DIR = path.join(LOCALAPPDATA, "electrond", "hooks");

function loadHookWidget(filename) {
  const id = "hook-" + filename.replace(".html", "");
  const filepath = path.join(HOOKS_DIR, filename);

  if (widgets[id]) {
    widgets[id].loadFile(filepath);
    return;
  }

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  // offset each hook widget so they don't stack exactly
  const hookCount = Object.keys(widgets).filter(k => k.startsWith("hook-")).length;
  const offset = hookCount * 30;

  const win = new BrowserWindow({
    width: 400, height: 300,
    x: sw - 430 - offset,
    y: Math.round(sh / 2 - 150) + offset,
    transparent: true,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    thickFrame: true,
    type: "toolbar",
    backgroundColor: "#00000000",
    roundedCorners: false,
    minWidth: 200,
    minHeight: 120,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.setSkipTaskbar(true);
  win.setAlwaysOnTop(true, "pop-up-menu");
  win.loadFile(filepath);
  widgets[id] = win;
  win.once("ready-to-show", () => win.showInactive());
  win.on("closed", () => { delete widgets[id]; });
}

function initHooks() {
  fs.mkdirSync(HOOKS_DIR, { recursive: true });

  // load existing hook files
  for (const file of fs.readdirSync(HOOKS_DIR)) {
    if (file.endsWith(".html")) loadHookWidget(file);
  }

  // watch for changes — debounce per file
  const timers = {};
  fs.watch(HOOKS_DIR, (eventType, filename) => {
    if (!filename || !filename.endsWith(".html")) return;
    // debounce: Windows fires multiple events per change
    clearTimeout(timers[filename]);
    timers[filename] = setTimeout(() => {
      const filepath = path.join(HOOKS_DIR, filename);
      const id = "hook-" + filename.replace(".html", "");
      if (fs.existsSync(filepath)) {
        loadHookWidget(filename);
      } else if (widgets[id]) {
        widgets[id].close();
        delete widgets[id];
      }
    }, 100);
  });
}

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
