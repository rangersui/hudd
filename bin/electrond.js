#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { DAEMON_DIR, DAEMON_JSON, cdpList } = require("../lib/cdp");

const VERSION = "0.1.0";
const APP_DIR = path.join(__dirname, "..");

function usage() {
  console.log(`electrond ${VERSION} -- Electron CDP daemon

Usage:
  electrond daemon [--port N]    start Electron with CDP (default 9500)
  electrond stop                 stop daemon
  electrond -V                   version`);
}

async function waitForCDP(port, retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await cdpList(port);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

async function daemon(port) {
  // electron npm package exports the path to the binary
  const electronPath = require("electron");

  // update CDP port in hud.js if needed
  const hudJs = path.join(APP_DIR, "hud.js");
  if (fs.existsSync(hudJs)) {
    let content = fs.readFileSync(hudJs, "utf-8");
    const updated = content.replace(
      /appendSwitch\("remote-debugging-port",\s*"\d+"\)/,
      `appendSwitch("remote-debugging-port", "${port}")`
    );
    if (updated !== content) fs.writeFileSync(hudJs, updated, "utf-8");
  }

  fs.mkdirSync(DAEMON_DIR, { recursive: true });

  const proc = spawn(electronPath, [APP_DIR], {
    stdio: "ignore",
    detached: false,
  });

  const info = {
    pid: proc.pid,
    port,
    app_dir: APP_DIR,
    started: new Date().toISOString(),
  };
  fs.writeFileSync(DAEMON_JSON, JSON.stringify(info, null, 2));

  console.log(`electrond ${VERSION}`);
  console.log(`  app:      ${APP_DIR}`);
  console.log(`  electron: ${electronPath}`);
  console.log(`  cdp:      http://127.0.0.1:${port}`);
  console.log(`  pid:      ${proc.pid}`);
  console.log(`  daemon:   ${DAEMON_JSON}`);

  const ready = await waitForCDP(port);
  if (ready) {
    const pages = await cdpList(port);
    console.log(`  pages:    ${pages.length}`);
    pages.forEach((p) => console.log(`    [${p.type}] ${p.title}`));
    console.log();
    console.log("ready. ctrl+c to stop.");
  } else {
    console.log("  WARNING: CDP not responding after 15s");
  }

  // graceful shutdown
  const shutdown = () => {
    proc.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  try {
    process.on("SIGBREAK", shutdown);
  } catch {}

  proc.on("exit", () => {
    try {
      fs.unlinkSync(DAEMON_JSON);
    } catch {}
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
  try {
    fs.unlinkSync(DAEMON_JSON);
  } catch {}
}

// ── CLI ──
const args = process.argv.slice(2);

if (!args.length || args[0] === "-h" || args[0] === "--help") {
  usage();
  process.exit(0);
}
if (args[0] === "-V" || args[0] === "--version") {
  console.log(`electrond ${VERSION}`);
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
