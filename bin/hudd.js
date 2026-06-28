#!/usr/bin/env node
"use strict";

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { DAEMON_DIR, DAEMON_JSON } = require("../lib/cdp");
const { CDPGateway } = require("../lib/gateway");

const VERSION = "0.1.0";
const APP_DIR = path.join(__dirname, "..");

function usage() {
  console.log(`hudd ${VERSION} -- Electron CDP daemon

Usage:
  hudd daemon [--port N]    start with auth gateway (default 9500)
  hudd stop                 stop daemon
  hudd -V                   version`);
}

// ── Security (copied from pythond) ──────────────────────

/**
 * Create a directory and lock its ACL so only the owner, SYSTEM, and
 * Administrators can access it. Equivalent to chmod 700 on POSIX.
 * @param {string} dirPath
 */
function secureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  if (process.platform === "win32") {
    try {
      execSync(
        `icacls "${dirPath}" /inheritance:r ` +
        `/grant:r "OWNER RIGHTS:(OI)(CI)(F)" ` +
        `/grant:r "SYSTEM:(OI)(CI)(F)" ` +
        `/grant:r "BUILTIN\\Administrators:(OI)(CI)(F)"`,
        { stdio: "ignore", timeout: 10000 }
      );
    } catch (e) {
      console.error(`FATAL: cannot set DACL on ${dirPath}: ${e.message}`);
      process.exit(1);
    }
  } else {
    fs.chmodSync(dirPath, 0o700);
  }
}

/**
 * Check if a process is alive (signal 0 probe).
 * @param {number} pid
 * @returns {boolean}
 */
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Atomically write daemon.json (write to .tmp then rename).
 * Contains port, token, pid, and start timestamp.
 * @param {number} port
 * @param {string} token
 * @param {number} pid
 */
function writeDaemonMeta(port, token, pid) {
  const data = { port, token, pid, started: new Date().toISOString() };
  const tmp = DAEMON_JSON + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  if (process.platform !== "win32") {
    fs.chmodSync(tmp, 0o600);
  }
  fs.renameSync(tmp, DAEMON_JSON);
}

// ── Daemon ──────────────────────────────────────────────

/**
 * Start the hudd daemon: spawn Electron with Chromium flags,
 * connect the CDP debugging pipe, and launch the auth gateway.
 * @param {number} port - TCP port for the auth gateway
 */
async function daemon(port) {
  let electronPath = require("electron");
  const token = crypto.randomBytes(16).toString("hex");

  secureDir(DAEMON_DIR);

  // Rename electron.exe → hudd.exe so Task Manager shows "hudd"
  if (process.platform === "win32") {
    const huddExe = path.join(path.dirname(electronPath), "hudd.exe");
    if (!fs.existsSync(huddExe)) {
      fs.copyFileSync(electronPath, huddExe);
      // Patch PE resources so Task Manager shows "hudd" not "Electron"
      try {
        const { rcedit } = require("rcedit");
        const icoPath = path.join(APP_DIR, "icons", "icon.ico");
        const opts = {
          "version-string": {
            FileDescription: "hudd",
            ProductName: "hudd",
            InternalName: "hudd",
          },
        };
        if (fs.existsSync(icoPath)) opts.icon = icoPath;
        await rcedit(huddExe, opts);
      } catch (e) {
        console.error(`WARN: rcedit failed: ${e.message} (Task Manager will show "Electron")`);
      }
    }
    electronPath = huddExe;
  }

  // Check for existing daemon
  if (fs.existsSync(DAEMON_JSON)) {
    try {
      const existing = JSON.parse(fs.readFileSync(DAEMON_JSON, "utf-8"));
      if (existing.pid && pidAlive(existing.pid)) {
        console.error(`ERR daemon already running (pid ${existing.pid}, port ${existing.port}). hudd stop first.`);
        process.exit(1);
      }
    } catch {}
  }

  // ── Chromium flags — must be on the real command line ──
  // appendSwitch() in hud.js runs AFTER Chromium's early init (sandbox
  // check, GPU process fork, etc.), so flags like --no-sandbox are too
  // late there. Pass everything here; hud.js keeps appendSwitch as
  // belt-and-suspenders for direct `electron hud.js` invocations.
  //
  // Principle: kill the protection layer, keep the rendering layer.
  //   KILL — CORS, CSP, permissions, storage sandbox, Service Workers, etc.
  //   KEEP — Canvas, WebGL, Web Audio, MediaStream, CSS, DOM.
  const chromiumFlags = [
    // protection layer: sandbox & security policy
    "--no-sandbox",
    "--disable-gpu-sandbox",
    "--disable-web-security",
    "--disable-site-isolation-trials",
    "--disable-site-isolation-for-policy",
    "--allow-running-insecure-content",
    "--allow-file-access-from-files",
    "--allow-insecure-localhost",
    "--ignore-certificate-errors",
    "--disable-popup-blocking",
    "--disable-prompt-on-repost",
    // protection layer: storage sandbox
    "--disable-databases",
    "--disable-local-storage",
    "--disable-session-storage",
    // protection layer: permissions
    // Removed --deny-permission-prompts: it blanket-denies ALL permissions
    // including camera/mic/screen capture. Sensitive permissions (media,
    // display-capture, geolocation) are handled in hud.js via
    // setPermissionRequestHandler — user clicks Allow/Deny per request.
    // protection layer: networking & telemetry
    "--disable-sync",
    "--disable-background-networking",
    "--disable-breakpad",
    "--disable-domain-reliability",
    "--disable-client-side-phishing-detection",
    "--no-pings",
    "--metrics-recording-only",
    // chrome UI, extensions, spell-check
    "--disable-translate",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-component-update",
    "--disable-component-extensions-with-background-pages",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-spell-checking",
    // browser product APIs that do not belong in widgets
    "--disable-print-preview",
    "--disable-presentation-api",
    "--disable-remote-playback-api",
    // Kept: notifications, speech API, shared workers. They are widget runtime
    // capabilities, and non-sensitive permission prompts auto-grant in hud.js.
    // renderer scheduling — keep widgets alive
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-v8-idle-tasks",
    "--disable-back-forward-cache",
    "--disable-lazy-loading",
    "--disable-scroll-to-text-fragment",
    // GPU — rendering layer, stays ON.
    // GPU acceleration is rendering infrastructure, not a protection layer.
    // Disabling it forces CPU software rasterization: slower, higher memory,
    // and in-process-gpu folds GPU work into the main process (bloating it
    // by 100-150 MB). Let the GPU run out-of-process where it belongs.
    //
    // Removed (were killing rendering):
    //   --disable-gpu-compositing   → forced software compositing
    //   --disable-gpu-early-init    → delayed GPU, caused first-frame jank
    //   --in-process-gpu            → folded GPU into main (+150MB)
    //   --disable-composited-antialiasing → killed composite layer AA
    //   --disable-oop-rasterization → pulled raster back to main thread
    "--disable-direct-composition-video-overlays",  // AMD driver spams E_INVALIDARG on VideoProcessorGetOutputExtension
    "--log-level=3",  // fatal only — suppress GPU driver noise
    // renderer internals
    "--disable-checker-imaging",
    "--disable-image-animation-resync",
    // A/B experiments — kill the entire framework
    "--force-fieldtrials=*/*",
    "--disable-field-trial-config",
    // V8 — cap heap, keep WASM for WebGL widgets
    "--js-flags=--max-old-space-size=128",
    // disable-features: protection layer
    "--disable-features=" + [
      // security policy
      "BlockInsecurePrivateNetworkRequests", "IsolateOrigins",
      "CrossOriginOpenerPolicy", "CrossOriginEmbedderPolicy",
      "CrossOriginIsolation", "OriginIsolation",
      "MixedContentAutoupgrade", "CertificateTransparencyComponentUpdater",
      // storage & caching
      "CacheStorage", "BackgroundSync", "PeriodicBackgroundSync", "BackgroundFetch",
      "FileSystemAccessAPI", "StorageBuckets", "CookieStore",
      "CookieDeprecationFacilitatedTesting",
      // service workers
      "ServiceWorkerAutoPreload", "SpeculativeServiceWorkerWarmUp",
      // credentials & identity
      "AutofillServerCommunication", "AutofillCreditCardAuthentication",
      "AutofillEnableAccountWalletStorage",
      "WebAuthentication", "SecurePaymentConfirmation", "WebPayments",
      "FedCm", "WebOTP", "SignedExchange", "TrustTokens",
      // privacy sandbox
      "PrivacySandboxAdsAPIs", "InterestCohortAPI", "BrowsingTopics",
      // safe browsing
      "SafeBrowsing", "SafeBrowsingEnhancedProtection", "HeavyAdIntervention",
      // navigation & preloading
      "NavigationPredictor", "Prerender2", "PrefetchProxy",
      "SpareRendererForSitePerProcess", "BackForwardCache",
      "TextFragmentAnchor", "OverscrollHistoryNavigation",
      // chrome features
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
      //       CapturedSurfaceControl — needed for getDisplayMedia
    ].join(","),
    // disable-blink-features: protection/irrelevant
    // Keep: Canvas, WebGL, Web Audio, MediaStream, CSS, ResizeObserver
    "--disable-blink-features=" + [
      "NetworkInformation", "BatteryStatus", "WebShare", "DigitalGoods",
      // Kept: Gamepad, ScreenOrientation, WakeLock. Interactive widgets and
      // long-running dashboards should use the standard Web APIs directly.
      "Bluetooth", "Serial", "HID",
      "StorageAccessAPI", "TopicsAPI",
      "ComputePressure",
    ].join(","),
  ];

  // Spawn Electron with --remote-debugging-pipe (no TCP port)
  // fd 3 = pipe input (we write), fd 4 = pipe output (we read)
  const proc = spawn(electronPath, [APP_DIR, "--remote-debugging-pipe", ...chromiumFlags], {
    stdio: ["ignore", "ignore", "inherit", "pipe", "pipe", "ipc"],
    detached: false,
  });

  writeDaemonMeta(port, token, proc.pid);

  // Auth gateway: pipe ↔ authenticated TCP
  let gateway;
  await new Promise((resolve) => {
    gateway = new CDPGateway({
      pipeWrite: proc.stdio[3],
      pipeRead: proc.stdio[4],
      proc,
      port,
      token,
      onReady: resolve,
    });
  });

  console.log(`hudd ${VERSION}`);
  console.log(`  app:      ${APP_DIR}`);
  console.log(`  electron: ${electronPath}`);
  console.log(`  gateway:  http://127.0.0.1:${port} (token auth)`);
  console.log(`  pid:      ${proc.pid}`);
  console.log(`  daemon:   ${DAEMON_JSON}`);

  // Wait for Electron to initialize
  let pages = [];
  for (let i = 0; i < 30; i++) {
    try {
      pages = await gateway.getTargets();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (pages.length) {
    console.log(`  pages:    ${pages.length}`);
    pages.forEach((p) => console.log(`    [${p.type}] ${p.title}`));
    console.log();
    console.log("ready. ctrl+c to stop.");
  } else {
    console.log("  WARNING: pipe not responding after 15s");
  }

  // Graceful shutdown
  const shutdown = () => {
    gateway.close();
    proc.kill();
    try { fs.unlinkSync(DAEMON_JSON); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  try { process.on("SIGBREAK", shutdown); } catch {}

  proc.on("exit", () => {
    gateway.close();
    try { fs.unlinkSync(DAEMON_JSON); } catch {}
    console.log("electron exited.");
    process.exit(0);
  });
}

/**
 * Stop the running daemon: read PID from daemon.json, send SIGTERM,
 * and clean up metadata. Tolerates corrupt/stale daemon.json.
 */
function stop() {
  if (!fs.existsSync(DAEMON_JSON)) {
    console.log("no daemon running");
    return;
  }
  let info = {};
  try {
    info = JSON.parse(fs.readFileSync(DAEMON_JSON, "utf-8"));
  } catch (e) {
    console.log(`invalid daemon metadata: ${e.message}`);
  }
  if (info.pid) {
    try {
      process.kill(info.pid, "SIGTERM");
      console.log(`stopped pid ${info.pid}`);
    } catch (e) {
      console.log(`kill ${info.pid}: ${e.message}`);
    }
  }
  try { fs.unlinkSync(DAEMON_JSON); } catch {}
}

// ── CLI ─────────────────────────────────────────────────
const args = process.argv.slice(2);

if (!args.length || args[0] === "-h" || args[0] === "--help") {
  usage();
  process.exit(0);
}
if (args[0] === "-V" || args[0] === "--version") {
  console.log(`hudd ${VERSION}`);
  process.exit(0);
}
if (args[0] === "daemon") {
  let port = 9500;
  const pi = args.indexOf("--port");
  if (pi !== -1 && args[pi + 1]) port = parseInt(args[pi + 1]);
  daemon(port);
} else if (args[0] === "stop") {
  stop();
} else {
  usage();
}
