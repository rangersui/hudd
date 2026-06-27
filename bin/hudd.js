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

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

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
  const chromiumFlags = [
    // security theater off — nodeIntegration:true already grants full RCE
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
    // strip to bare rendering shell — networking & telemetry
    "--disable-sync",
    "--disable-background-networking",
    "--disable-breakpad",
    "--disable-domain-reliability",
    "--disable-client-side-phishing-detection",
    "--no-pings",
    "--metrics-recording-only",
    // chrome UI & extensions
    "--disable-translate",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-component-update",
    "--disable-component-extensions-with-background-pages",
    "--no-first-run",
    "--no-default-browser-check",
    // web APIs we never use
    "--disable-speech-api",
    "--disable-print-preview",
    "--disable-notifications",
    "--disable-presentation-api",
    "--disable-remote-playback-api",
    "--disable-shared-workers",
    "--disable-remote-fonts",
    "--disable-webrtc-encryption",
    "--deny-permission-prompts",
    // renderer & scheduling
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-renderer-backgrounding",
    "--disable-v8-idle-tasks",
    "--disable-back-forward-cache",
    "--disable-lazy-loading",
    "--disable-scroll-to-text-fragment",
    // GPU
    "--disable-gpu-compositing",
    "--disable-gpu-early-init",
    "--in-process-gpu",
    // feature flags
    "--disable-features=" + [
      "TranslateUI", "SpareRendererForSitePerProcess", "AutofillServerCommunication",
      "MediaRouter", "CalculateNativeWinOcclusion",
      "WebRtcHideLocalIpsWithMdns", "WebUSB", "WebBluetooth", "WebNFC",
      "IdleDetection", "PeriodicBackgroundSync", "BackgroundFetch",
      "NavigationPredictor", "Prerender2", "PrefetchProxy",
      "OptimizationHints", "OptimizationGuideFetching", "OptimizationGuideModelDownloading",
      "OnDeviceWebSpeech", "PrivacySandboxAdsAPIs", "InterestCohortAPI", "BrowsingTopics",
      "TrustTokens", "FedCm", "SignedExchange", "WebPayments",
      "SafeBrowsing", "SafeBrowsingEnhancedProtection", "HeavyAdIntervention",
      "TextFragmentAnchor", "SpeculativeServiceWorkerWarmUp", "ServiceWorkerAutoPreload",
      "UseEcoQoSForBackgroundProcess", "AutofillEnableAccountWalletStorage",
      "GlobalMediaControls", "GlobalMediaControlsForCast",
      "LiveCaption", "LensOverlay", "OverscrollHistoryNavigation",
      "BlockInsecurePrivateNetworkRequests", "IsolateOrigins",
      "CrossOriginOpenerPolicy", "CrossOriginEmbedderPolicy",
      "WebAuthentication", "SecurePaymentConfirmation",
    ].join(","),
    // blink feature kills
    "--disable-blink-features=NetworkInformation,BatteryStatus,WebShare,DigitalGoods",
  ];

  // Spawn Electron with --remote-debugging-pipe (no TCP port)
  // fd 3 = pipe input (we write), fd 4 = pipe output (we read)
  const proc = spawn(electronPath, [APP_DIR, "--remote-debugging-pipe", ...chromiumFlags], {
    stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"],
    detached: false,
  });

  writeDaemonMeta(port, token, proc.pid);

  // Auth gateway: pipe ↔ authenticated TCP
  let gateway;
  await new Promise((resolve) => {
    gateway = new CDPGateway({
      pipeWrite: proc.stdio[3],
      pipeRead: proc.stdio[4],
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

function stop() {
  if (!fs.existsSync(DAEMON_JSON)) {
    console.log("no daemon running");
    return;
  }
  const info = JSON.parse(fs.readFileSync(DAEMON_JSON, "utf-8"));
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
