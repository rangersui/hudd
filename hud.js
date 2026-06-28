const { app, BrowserWindow, ipcMain, screen, globalShortcut, Menu, dialog, session } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const vm = require("vm");

// CDP: gateway passes --remote-debugging-pipe at spawn time.
// Raw TCP port only if explicitly requested (dev mode, no auth).
if (process.env.HUDD_CDP_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.HUDD_CDP_PORT);
}
// ══════════════════════════════════════════════════════════════════
// Scorched earth: kill the protection layer, keep the rendering layer.
//
//   KILL  — anything that exists because browsers don't trust web pages:
//           CORS, CSP, permissions, storage sandbox, Service Workers,
//           certificate checks, mixed content, cookie policy, etc.
//
//   KEEP  — anything that IS the rendering engine:
//           Canvas, WebGL, Web Audio, MediaStream, CSS animations,
//           ResizeObserver, <video>/<audio>, requestAnimationFrame.
//
// nodeIntegration:true already grants full RCE. Every "security" feature
// is pure dead weight — memory, startup time, code paths never taken.
//
// NOTE: bin/hudd.js passes these on the real command line (required for
// pre-init flags like --no-sandbox whose checks run before JS loads).
// appendSwitch below is belt-and-suspenders for direct `electron hud.js`.
// ══════════════════════════════════════════════════════════════════

// ── Protection layer: sandbox & security policy ──
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("disable-web-security");
app.commandLine.appendSwitch("disable-site-isolation-trials");
app.commandLine.appendSwitch("disable-site-isolation-for-policy");
app.commandLine.appendSwitch("allow-running-insecure-content");
app.commandLine.appendSwitch("allow-file-access-from-files");
app.commandLine.appendSwitch("allow-insecure-localhost");
app.commandLine.appendSwitch("ignore-certificate-errors");
app.commandLine.appendSwitch("disable-popup-blocking");
app.commandLine.appendSwitch("disable-prompt-on-repost");
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

// ── Protection layer: storage sandbox ──
// require('fs') is storage. require('better-sqlite3') is the database.
// Browser storage exists because web pages can't touch the filesystem.
app.commandLine.appendSwitch("disable-databases");
app.commandLine.appendSwitch("disable-local-storage");
app.commandLine.appendSwitch("disable-session-storage");

// ── Permissions ──
// Removed deny-permission-prompts: it blanket-denies camera/mic/screen.
// Sensitive permissions are routed through setPermissionRequestHandler below;
// non-sensitive widget permissions auto-grant there.

// ── Protection layer: networking & telemetry ──
app.commandLine.appendSwitch("disable-sync");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-breakpad");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("disable-client-side-phishing-detection");
app.commandLine.appendSwitch("no-pings");
app.commandLine.appendSwitch("metrics-recording-only");

// ── Chrome UI, extensions, spell-check — not a browser ──
app.commandLine.appendSwitch("disable-translate");
app.commandLine.appendSwitch("disable-default-apps");
app.commandLine.appendSwitch("disable-extensions");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-component-extensions-with-background-pages");
app.commandLine.appendSwitch("no-first-run");
app.commandLine.appendSwitch("no-default-browser-check");
app.commandLine.appendSwitch("disable-spell-checking");

// ── Browser product APIs that do not belong in widgets ──
app.commandLine.appendSwitch("disable-print-preview");
app.commandLine.appendSwitch("disable-presentation-api");
app.commandLine.appendSwitch("disable-remote-playback-api");
// Kept: notifications, speech API, shared workers. They are widget runtime
// capabilities, and non-sensitive permission prompts auto-grant below.

// ── Renderer scheduling — keep widgets alive ──
app.commandLine.appendSwitch("disable-hang-monitor");
app.commandLine.appendSwitch("disable-ipc-flooding-protection");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-v8-idle-tasks");
app.commandLine.appendSwitch("disable-back-forward-cache");
app.commandLine.appendSwitch("disable-lazy-loading");
app.commandLine.appendSwitch("disable-scroll-to-text-fragment");

// ── GPU — rendering layer, stays ON ──
// GPU acceleration is rendering infrastructure, not a protection layer.
// Disabling it forces CPU software rasterization: slower, higher memory,
// and in-process-gpu folds GPU work into the main process (bloating it
// by 100-150 MB). Let the GPU run out-of-process where it belongs.
app.commandLine.appendSwitch("disable-gpu-sandbox");  // already set above, harmless duplicate
app.commandLine.appendSwitch("disable-direct-composition-video-overlays");  // AMD driver spams E_INVALIDARG on VideoProcessorGetOutputExtension
app.commandLine.appendSwitch("log-level", "3");  // fatal only — suppress GPU driver noise

// ── Renderer internals ──
app.commandLine.appendSwitch("disable-checker-imaging");
app.commandLine.appendSwitch("disable-image-animation-resync");

// ── A/B experiments — kill the entire framework ──
app.commandLine.appendSwitch("force-fieldtrials", "*/*");
app.commandLine.appendSwitch("disable-field-trial-config");

// ── V8 — cap heap, keep WASM for WebGL widgets ──
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=128");

// ── disable-features: protection layer features ──
app.commandLine.appendSwitch("disable-features", [
  // security policy
  "BlockInsecurePrivateNetworkRequests", "IsolateOrigins",
  "CrossOriginOpenerPolicy", "CrossOriginEmbedderPolicy",
  "CrossOriginIsolation", "OriginIsolation",
  "MixedContentAutoupgrade", "CertificateTransparencyComponentUpdater",
  // storage & caching (require('fs') is storage)
  "CacheStorage", "BackgroundSync", "PeriodicBackgroundSync", "BackgroundFetch",
  "FileSystemAccessAPI", "StorageBuckets", "CookieStore",
  "CookieDeprecationFacilitatedTesting",
  // service workers (local files don't need offline cache)
  "ServiceWorkerAutoPreload", "SpeculativeServiceWorkerWarmUp",
  // credentials & identity (no login forms, no autofill)
  "AutofillServerCommunication", "AutofillCreditCardAuthentication",
  "AutofillEnableAccountWalletStorage",
  "WebAuthentication", "SecurePaymentConfirmation", "WebPayments",
  "FedCm", "WebOTP", "SignedExchange", "TrustTokens",
  // privacy sandbox (not a browser)
  "PrivacySandboxAdsAPIs", "InterestCohortAPI", "BrowsingTopics",
  // safe browsing (we trust all code — it's ours)
  "SafeBrowsing", "SafeBrowsingEnhancedProtection", "HeavyAdIntervention",
  // navigation & preloading (single-page widgets, no URL navigation)
  "NavigationPredictor", "Prerender2", "PrefetchProxy",
  "SpareRendererForSitePerProcess", "BackForwardCache",
  "TextFragmentAnchor", "OverscrollHistoryNavigation",
  // chrome features (not a browser)
  "TranslateUI", "MediaRouter", "CalculateNativeWinOcclusion",
  "OptimizationHints", "OptimizationGuideFetching", "OptimizationGuideModelDownloading",
  "UseEcoQoSForBackgroundProcess", "ReduceUserAgentMinorVersion",
  "LensOverlay", "LiveCaption",
  "GlobalMediaControls", "GlobalMediaControlsForCast",
  // hardware/browser product APIs with no default HUD use case
  "WebUSB", "WebBluetooth", "WebNFC",
  "IdleDetection", "Portals", "DirectSockets",
  "ContactsManager", "ContentIndex",
  // Kept: OnDeviceWebSpeech and WindowPlacement. Voice widgets and multi-screen
  // HUDs are first-class runtime use cases, not browser protection layers.
  // media metadata (not playback/capture)
  "MediaSession", "MediaEngagement",
  "AutoPictureInPicture",
  // Kept: MediaCapabilities (codec query), SurfaceCapture,
  // CapturedSurfaceControl — needed for getDisplayMedia.
].join(","));

// ── disable-blink-features: protection/irrelevant blink features ──
// Keep: Canvas, WebGL, Web Audio, MediaStream, CSS, ResizeObserver,
//       IntersectionObserver — these ARE the rendering engine.
app.commandLine.appendSwitch("disable-blink-features", [
  "NetworkInformation", "BatteryStatus", "WebShare", "DigitalGoods",
  // Kept: Gamepad, ScreenOrientation, WakeLock. Interactive widgets and
  // long-running dashboards should use the standard Web APIs directly.
  "Bluetooth", "Serial", "HID",
  "StorageAccessAPI", "TopicsAPI",
  "ComputePressure",
].join(","));

const widgets = {};  // id -> BrowserWindow
const _log = fs.createWriteStream(path.join(__dirname, "hud.log"), { flags: "w" });
function log(...args) { _log.write(new Date().toISOString() + " " + args.join(" ") + "\n"); }

// ── Configurable defaults — meta tags override any of these ──
const DEFAULTS = {
  defaultWidth: 360, defaultHeight: 260, pad: 30,
  transparent: true, frame: false, hasShadow: false,
  roundedCorners: false, backgroundColor: "#00000000",
  windowType: "toolbar",
  alwaysOnTop: true, skipTaskbar: true,
  resizable: false, movable: true, focusable: true,
  level: "pop-up-menu",
  minWidth: 200, minHeight: 120,
};

const OVERLAY_DEFAULTS = {
  focusable: false, resizable: false, movable: false,
  level: "screen-saver", clickThrough: true,
};

// ════════════════════════════════════════════
// METADATA
// ════════════════════════════════════════════

function readMeta(filepath) {
  try {
    const head = fs.readFileSync(filepath, "utf-8").slice(0, 2000);
    // Convention: single-quote wrapper. JSON uses " internally, so
    // content='{"width":300}' is the only correct form. Double-quote
    // wrapper is impossible — " inside JSON would close the HTML attribute.
    const m = head.match(/<meta\s+name="hudd"\s+content='([^']+)'/);
    return m ? JSON.parse(m[1]) : null;
  } catch { return null; }
}

function loadWidgetFile(win, id, filepath) {
  const onError = (err) => {
    log(`[loadFile] FAILED ${id} from ${filepath}:`, err && (err.stack || err.message || err));
  };
  try {
    const result = win.loadFile(filepath, { query: { id } });
    if (result && typeof result.catch === "function") result.catch(onError);
  } catch (err) {
    onError(err);
  }
}

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveMeta(meta) {
  const display = screen.getPrimaryDisplay();

  // overlay — fullscreen, inset for taskbar auto-hide
  if (meta.type === "overlay") {
    const inset = meta.inset != null ? meta.inset : 1;
    const { x, y, width, height } = display.bounds;
    return { ...meta, x: x + inset, y: y + inset, width: width - inset * 2, height: height - inset * 2 };
  }

  // normal widget — all values from DEFAULTS, meta overrides
  const { width: sw, height: sh } = display.workAreaSize;
  const w = meta.width || DEFAULTS.defaultWidth;
  const h = meta.height || DEFAULTS.defaultHeight;
  const pad = meta.pad != null ? meta.pad : DEFAULTS.pad;
  let x, y;

  if (meta.x != null && meta.y != null) {
    x = meta.x; y = meta.y;
  } else if (meta.position) {
    switch (meta.position) {
      case "top-left":       x = pad;                        y = pad;                         break;
      case "top-right":      x = sw - w - pad;               y = pad;                         break;
      case "bottom-left":    x = pad;                        y = sh - h - pad;                break;
      case "bottom-right":   x = sw - w - pad;               y = sh - h - pad;                break;
      case "bottom-center":  x = Math.round((sw - w) / 2);   y = sh - h - pad;                break;
      case "center":         x = Math.round((sw - w) / 2);   y = Math.round((sh - h) / 2);   break;
      default:               x = sw - w - pad;               y = sh - h - pad;
    }
  } else {
    // cascade from top-right
    const n = Object.keys(widgets).length;
    x = sw - w - pad - (n % 5) * pad;
    y = pad + (n % 10) * pad;
  }

  return { ...meta, width: w, height: h, x, y };
}

// ════════════════════════════════════════════
// WIDGET FACTORY
// ════════════════════════════════════════════

function createWidget(id, filepath, meta, { untrusted = false } = {}) {
  if (widgets[id]) return widgets[id];

  const m = resolveMeta(meta);
  const ov = m.type === "overlay";

  // layer: DEFAULTS → overlay (if applicable) → meta declaration
  const d = { ...DEFAULTS, ...(ov ? OVERLAY_DEFAULTS : {}), ...m };

  // Trust boundary: per-directory, not per-runtime.
  //   trusted (app dir, hooks dir) — nodeIntegration: true, full Node.js + DOM
  //   untrusted (external dir)     — sandboxed, no Node, no file access
  const webPreferences = untrusted
    ? {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      }
    : {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        webviewTag: !!m.webviewTag,
      };

  const win = new BrowserWindow({
    width: m.width, height: m.height,
    x: m.x, y: m.y,
    transparent: d.transparent,
    frame: d.frame,
    show: false,
    focusable: d.focusable,
    alwaysOnTop: d.alwaysOnTop,
    skipTaskbar: d.skipTaskbar,
    resizable: d.resizable,
    movable: d.movable,
    hasShadow: d.hasShadow,
    thickFrame: d.resizable,
    type: d.windowType,
    backgroundColor: d.backgroundColor,
    roundedCorners: d.roundedCorners,
    minWidth: d.resizable ? d.minWidth : undefined,
    minHeight: d.resizable ? d.minHeight : undefined,
    webPreferences,
  });

  // Untrusted widgets: lock down navigation and new windows
  if (untrusted) {
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }

  if (d.clickThrough) win.setIgnoreMouseEvents(true, { forward: true });
  if (d.alwaysOnTop) win.setAlwaysOnTop(true, d.level);

  loadWidgetFile(win, id, filepath);
  widgets[id] = win;
  log(`created ${id}`);
  win.once("ready-to-show", () => win.showInactive());
  win.on("closed", () => { log(`closed ${id}`); delete widgets[id]; });

  // right-click → DevTools
  win.webContents.on("context-menu", (_e, params) => {
    Menu.buildFromTemplate([
      { label: `Inspect (${id})`, click: () => {
        if (!win.webContents.isDevToolsOpened()) win.webContents.openDevTools({ mode: "detach" });
        win.webContents.inspectElement(params.x, params.y);
      }},
      { label: "DevTools", click: () => {
        if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
        else win.webContents.openDevTools({ mode: "detach" });
      }},
      { type: "separator" },
      { label: "Reload", click: () => win.webContents.reload() },
      { label: "Close", click: () => win.close() },
    ]).popup();
  });

  if (m.trackPosition) {
    win.on("moved", () => { if (!win.isDestroyed()) win.webContents.send("position-changed"); });
    win.on("resized", () => { if (!win.isDestroyed()) win.webContents.send("position-changed"); });
  }

  return win;
}

// ════════════════════════════════════════════
// LOADING
// ════════════════════════════════════════════

const scripts = {};  // id -> { module, dispose }

function loadDir(dir, opts = {}) {
  const { prefix, defaultOnNoMeta, untrusted = false } = opts;

  // ── HTML widgets ──
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".html"))) {
    const filepath = path.join(dir, file);
    const meta = readMeta(filepath);

    if (!meta && !defaultOnNoMeta) continue;

    const id = prefix
      ? prefix + file.replace(".html", "")
      : ((meta && meta.id) || file.replace(".html", ""));

    if (widgets[id]) { log(`[loadDir] skip ${id} — already exists`); continue; }

    try {
      createWidget(id, filepath, meta || { resizable: true }, { untrusted });
      log(`[loadDir] created ${id} from ${file}${untrusted ? " (untrusted)" : ""}`);
    } catch (err) {
      log(`[loadDir] FAILED to create ${id} from ${file}:`, err);
    }
  }

  // ── JS scripts (trusted dirs only) ──
  if (!prefix || untrusted) return;  // app dir and external dir don't auto-run .js
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".js"))) {
    const filepath = path.join(dir, file);
    const id = prefix + file.replace(".js", "");
    if (scripts[id]) continue;
    loadScript(id, filepath);
  }
}

function loadScript(id, filepath) {
  try {
    const resolved = require.resolve(filepath);
    delete require.cache[resolved];
    const mod = require(resolved);
    scripts[id] = { path: filepath, dispose: typeof mod === "function" ? mod : (mod && mod.dispose) };
    log(`[loadDir] script ${id} loaded`);
  } catch (err) {
    log(`[loadDir] FAILED script ${id}:`, err);
  }
}

function unloadScript(id) {
  const s = scripts[id];
  if (!s) return;
  try { if (typeof s.dispose === "function") s.dispose(); } catch {}
  try { delete require.cache[require.resolve(s.path)]; } catch {}
  delete scripts[id];
  log(`[loadDir] script ${id} unloaded`);
}

function handleChange(dir, filename, prefix, { untrusted = false } = {}) {
  const filepath = path.join(dir, filename);

  if (filename.endsWith(".js")) {
    if (untrusted) return;  // external dir: no .js execution
    const id = prefix + filename.replace(".js", "");
    if (!fs.existsSync(filepath)) { unloadScript(id); return; }
    unloadScript(id);
    loadScript(id, filepath);
    return;
  }

  const id = prefix + filename.replace(".html", "");

  if (!fs.existsSync(filepath)) {
    if (widgets[id]) widgets[id].close();
    return;
  }

  // existing widget — just reload content
  if (widgets[id]) {
    loadWidgetFile(widgets[id], id, filepath);
    return;
  }

  // new file — create
  const meta = readMeta(filepath);
  try {
    createWidget(id, filepath, meta || { resizable: true }, { untrusted });
  } catch (err) {
    log(`[loadDir] FAILED to create ${id} from ${filename}:`, err && (err.stack || err.message || err));
  }
}

function watchDir(dir, prefix, { untrusted = false } = {}) {
  const timers = {};
  fs.watch(dir, (_event, filename) => {
    if (!filename) return;
    if (!filename.endsWith(".html") && !filename.endsWith(".js")) return;
    clearTimeout(timers[filename]);
    timers[filename] = setTimeout(() => handleChange(dir, filename, prefix, { untrusted }), 100);
  });
}

// ════════════════════════════════════════════
// EVENTS — broadcast to all widgets
// ════════════════════════════════════════════

function broadcast(event, ...args) {
  for (const win of Object.values(widgets)) {
    if (!win.isDestroyed()) win.webContents.send(event, ...args);
  }
}

// ════════════════════════════════════════════
// OPEN FILE — any .html becomes a widget
// ════════════════════════════════════════════

function openFile(filepath) {
  if (typeof filepath !== "string" || !filepath) return;
  filepath = path.resolve(filepath);
  if (!filepath.endsWith(".html") || !fs.existsSync(filepath)) return;
  const basename = path.basename(filepath, ".html");
  // reuse if same file already open
  if (widgets[basename]) {
    widgets[basename].show();
    widgets[basename].focus();
    return;
  }
  const meta = readMeta(filepath) || { resizable: true };
  try {
    createWidget(basename, filepath, meta);
  } catch (err) {
    log(`[openFile] FAILED to create ${basename} from ${filepath}:`, err && (err.stack || err.message || err));
  }
}

function parseFilesFromArgv(argv) {
  // argv: [electron, hud.js, ...files] or [hudd.exe, ...files]
  for (const arg of argv.slice(1)) {
    if (arg.endsWith(".html") && !arg.startsWith("-")) openFile(arg);
  }
}

// ════════════════════════════════════════════
// BOOT — single instance lock
// ════════════════════════════════════════════

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); return; }

app.on("second-instance", (_e, argv) => parseFilesFromArgv(argv));

const DATA_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), "hudd");
const HOOKS_DIR = path.join(DATA_DIR, "hooks");
const EXTERNAL_DIR = path.join(DATA_DIR, "external");

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);  // no default menu — saves memory, right-click still works

  // ── Media permissions — ask the user, don't blanket-deny ──
  // Sensitive permissions (camera, mic, screen capture) show a native dialog.
  // Everything else auto-grants — widgets are trusted local code.
  const SENSITIVE = new Set(["media", "display-capture", "geolocation"]);
  const FRIENDLY  = { media: "camera/microphone", "display-capture": "screen capture", geolocation: "location" };
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => {
    let replied = false;
    const reply = (allow) => {
      if (replied) return;
      replied = true;
      try { cb(allow); } catch {}
    };
    if (!SENSITIVE.has(perm)) return reply(true);
    const win = BrowserWindow.fromWebContents(wc);
    const title = (win && !win.isDestroyed() && win.getTitle()) || "Widget";
    const owner = win && !win.isDestroyed() ? win : undefined;
    const options = {
      type: "question",
      buttons: ["Allow", "Deny"],
      defaultId: 0,
      title: "Permission request",
      message: `"${title}" wants access to ${FRIENDLY[perm] || perm}.`,
    };
    const request = owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
    request.then(({ response }) => reply(response === 0))
      .catch((err) => {
        log(`[permission] denied ${perm}:`, err && (err.stack || err.message || err));
        reply(false);
      });
  });
  loadDir(__dirname, { prefix: null, defaultOnNoMeta: false });

  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  loadDir(HOOKS_DIR, { prefix: "hook-", defaultOnNoMeta: true });
  watchDir(HOOKS_DIR, "hook-");

  // external dir — reserved namespace for untrusted content.
  // v0: directory exists, nothing loads. Zero attack surface.
  // Putting a file here is a deliberate act — the UX is the filesystem.
  fs.mkdirSync(EXTERNAL_DIR, { recursive: true });

  parseFilesFromArgv(process.argv);

  const restoreKey = process.env.HUDD_RESTORE_KEY || "F10";
  globalShortcut.register(restoreKey, () => {
    for (const [id, win] of Object.entries(widgets)) {
      if (!win.isDestroyed() && !win.isVisible()) {
        win.show();
        broadcast("widget-restored", id);
      }
    }
  });
});

// ════════════════════════════════════════════
// IPC — all generic, zero widget names
// ════════════════════════════════════════════

ipcMain.on("minimize-widget", (_e, id) => {
  if (widgets[id]) { widgets[id].hide(); broadcast("widget-minimized", id); }
});

ipcMain.on("close-widget", (_e, id) => {
  log(`IPC close-widget: ${id}`);
  const win = widgets[id];
  if (!win) return;
  win.once("closed", () => broadcast("widget-closed", id));
  win.close();
});

ipcMain.on("restore-widget", (_e, id) => {
  if (widgets[id]) { widgets[id].show(); broadcast("widget-restored", id); }
});

ipcMain.on("create-widget", (_e, data) => {
  if (!data || typeof data !== "object" || typeof data.id !== "string" || !data.id) {
    log("[IPC] ignored create-widget with invalid payload");
    return;
  }
  const filepath = typeof data.filePath === "string"
    ? data.filePath
    : typeof data.htmlFile === "string"
      ? path.join(__dirname, data.htmlFile)
      : null;
  if (!filepath) {
    log(`[IPC] ignored create-widget ${data.id}: missing filePath/htmlFile`);
    return;
  }
  try {
    createWidget(data.id, filepath, data);
  } catch (err) {
    log(`[IPC] FAILED create-widget ${data.id}:`, err && (err.stack || err.message || err));
  }
});

ipcMain.on("open-file", (_e, filepath) => {
  openFile(filepath);
});

ipcMain.on("set-ignore-mouse", (e, ignore) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on("set-bounds", (e, bounds) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed() || !bounds || typeof bounds !== "object") return;
  // Atomic: position + size in one call to avoid flicker
  const cur = win.getBounds();
  win.setBounds({
    x:      validNumber(bounds.x) ? bounds.x : cur.x,
    y:      validNumber(bounds.y) ? bounds.y : cur.y,
    width:  validNumber(bounds.width) && bounds.width > 0 ? bounds.width : cur.width,
    height: validNumber(bounds.height) && bounds.height > 0 ? bounds.height : cur.height,
  });
});

ipcMain.handle("get-own-bounds", (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
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

ipcMain.handle("list-widgets", () => {
  const result = {};
  for (const [id, win] of Object.entries(widgets)) {
    if (!win.isDestroyed()) result[id] = { visible: win.isVisible() };
  }
  return result;
});

ipcMain.handle("list-available", () => {
  const available = {};
  // app dir — only files with meta
  for (const file of fs.readdirSync(__dirname).filter(f => f.endsWith(".html"))) {
    const meta = readMeta(path.join(__dirname, file));
    if (!meta) continue;
    const id = (meta && meta.id) || file.replace(".html", "");
    available[id] = { file, dir: __dirname, loaded: !!widgets[id] };
  }
  // hooks dir
  try {
    for (const file of fs.readdirSync(HOOKS_DIR).filter(f => f.endsWith(".html"))) {
      const id = "hook-" + file.replace(".html", "");
      available[id] = { file, dir: HOOKS_DIR, loaded: !!widgets[id] };
    }
  } catch {}
  // external dir — visible but never loaded (untrusted)
  try {
    for (const file of fs.readdirSync(EXTERNAL_DIR).filter(f => f.endsWith(".html"))) {
      const id = "ext-" + file.replace(".html", "");
      available[id] = { file, dir: EXTERNAL_DIR, loaded: false, untrusted: true };
    }
  } catch {}
  return available;
});

ipcMain.on("reopen-widget", (_e, id) => {
  if (widgets[id]) { widgets[id].show(); widgets[id].focus(); return; }
  // find the file
  const dirs = [
    { dir: __dirname, prefix: null },
    { dir: HOOKS_DIR, prefix: "hook-" },
  ];
  for (const { dir, prefix } of dirs) {
    try {
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".html"))) {
        const fid = prefix
          ? prefix + file.replace(".html", "")
          : ((readMeta(path.join(dir, file)) || {}).id || file.replace(".html", ""));
        if (fid === id) {
          const filepath = path.join(dir, file);
          const meta = readMeta(filepath) || { resizable: true };
          createWidget(id, filepath, meta);
          return;
        }
      }
    } catch {}
  }
});

ipcMain.on("start-drag", (e, data) => {
  if (!data || typeof data !== "object") return;
  const { id, mouseX, mouseY } = data;
  if (typeof id !== "string" || !validNumber(mouseX) || !validNumber(mouseY)) return;
  const win = widgets[id];
  if (!win) return;
  const [wx, wy] = win.getPosition();
  const move = (_e2, pos) => {
    if (!pos || typeof pos !== "object" || !validNumber(pos.x) || !validNumber(pos.y)) return;
    if (!win.isDestroyed()) win.setPosition(wx + pos.x - mouseX, wy + pos.y - mouseY);
  };
  const cleanup = () => {
    ipcMain.removeListener("drag-move", move);
    ipcMain.removeListener("drag-end", cleanup);
  };
  ipcMain.on("drag-move", move);
  ipcMain.on("drag-end", cleanup);
  // Guard: if window closes mid-drag, clean up listeners
  win.once("closed", cleanup);
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => { /* daemon stays alive — widgets arrive via hooks, CLI, or IPC */ });

// ════════════════════════════════════════════
// MAIN EVAL — persistent, windowless Node.js runtime
// ════════════════════════════════════════════
// vm.createContext gives a persistent context where const/let/var all
// survive across runInContext calls (same as Node.js REPL internals).
// No window, no DOM — pure Node.js.  Gateway routes here via IPC.

const mainContext = vm.createContext({
  require, console, process, Buffer,
  setTimeout, setInterval, setImmediate,
  clearTimeout, clearInterval, clearImmediate,
  URL, URLSearchParams, TextEncoder, TextDecoder,
  queueMicrotask,
  // Electron main-process APIs
  app, BrowserWindow, screen, ipcMain, Menu, globalShortcut,
  // hudd runtime — inspect and control widgets from main context
  widgets, broadcast, log,
});
mainContext.global = mainContext;

if (typeof process.send === "function") {
  process.on("message", async (msg) => {
    if (msg?.type !== "main-eval") return;
    try {
      let result = vm.runInContext(msg.code, mainContext);
      if (result != null && typeof result.then === "function") result = await result;
      if (result === undefined) {
        process.send({ type: "main-eval-result", id: msg.id });
      } else {
        try {
          JSON.stringify(result);  // verify serializable (IPC uses JSON)
          process.send({ type: "main-eval-result", id: msg.id, value: result });
        } catch {
          process.send({ type: "main-eval-result", id: msg.id, value: require("util").inspect(result) });
        }
      }
    } catch (e) {
      process.send({ type: "main-eval-result", id: msg.id, error: e.stack || String(e) });
    }
  });
}
