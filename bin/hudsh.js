#!/usr/bin/env node
"use strict";

const http = require("http");
const { cdpList, findPage, cdpEval, cdpMainEval, getPort, getToken } = require("../lib/cdp");

const VERSION = "0.1.0";

function usage() {
  console.log(`hudsh -- client for hudd pages

Usage:
  hudsh run <js>            evaluate JS in main process (no DOM, persistent)
  hudsh run <page> <js>     evaluate JS in a page
  hudsh ls                  list pages
  hudsh kill <page>         close a page
  hudsh status <page>       page info
  hudsh attach <page>       open DevTools URL
  hudsh -V                  version`);
}

async function cmdLs() {
  const targets = await cdpList();
  if (!targets.length) {
    console.log("(no pages)");
    return;
  }
  for (const t of targets) {
    const marker = t.type === "page" ? " " : "  ";
    console.log(`${marker}[${t.type}] ${t.title}`);
  }
}

async function cmdRun(name, code) {
  const targets = await cdpList();
  const page = findPage(name, targets);
  if (!page) {
    console.error(`ERR page '${name}' not found. available:`);
    targets.forEach((t) => console.error(`  [${t.type}] ${t.title}`));
    process.exit(1);
  }
  if (!page.webSocketDebuggerUrl) {
    console.error(`ERR no WebSocket URL for '${name}'`);
    process.exit(1);
  }

  const result = await cdpEval(page.webSocketDebuggerUrl, code);
  if (result && typeof result === "object" && "error" in result) {
    console.error(`ERR ${result.error}`);
    process.exit(1);
  }
  if (result !== null && result !== undefined) {
    if (typeof result === "object") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result);
    }
  }
}

async function cmdRunMain(code) {
  const result = await cdpMainEval(code);
  if (result && typeof result === "object" && "error" in result) {
    console.error(`ERR ${result.error}`);
    process.exit(1);
  }
  if (result !== null && result !== undefined) {
    if (typeof result === "object") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result);
    }
  }
}

async function cmdKill(name) {
  const targets = await cdpList();
  const page = findPage(name, targets);
  if (!page) {
    console.error(`ERR page '${name}' not found`);
    process.exit(1);
  }
  const port = getPort();
  const token = getToken();
  return new Promise((resolve, reject) => {
    http
      .get({
        hostname: "127.0.0.1",
        port,
        path: `/json/close/${page.id}`,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }, () => {
        console.log(`closed: ${name}`);
        resolve();
      })
      .on("error", (e) => {
        console.error(`ERR closing '${name}': ${e.message}`);
        process.exit(1);
      });
  });
}

async function cmdStatus(name) {
  const targets = await cdpList();
  const page = findPage(name, targets);
  if (!page) {
    console.error(`ERR page '${name}' not found`);
    process.exit(1);
  }
  const info = {
    title: page.title,
    type: page.type,
    url: page.url,
    id: page.id,
  };
  if (page.webSocketDebuggerUrl) {
    try {
      const extra = await cdpEval(
        page.webSocketDebuggerUrl,
        `({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          dpr: window.devicePixelRatio,
          domNodes: document.querySelectorAll('*').length,
        })`
      );
      if (extra && !extra.error) Object.assign(info, extra);
    } catch {}
  }
  console.log(JSON.stringify(info, null, 2));
}

async function cmdAttach(name) {
  const targets = await cdpList();
  const page = findPage(name, targets);
  if (!page) {
    console.error(`ERR page '${name}' not found`);
    process.exit(1);
  }
  // DevTools URL with token for WebSocket auth
  const port = getPort();
  const token = getToken();
  const wsAddr = `127.0.0.1:${port}/devtools/page/${page.id}?token=${token}`;
  const url = `devtools://devtools/bundled/inspector.html?ws=${wsAddr}`;
  console.log(url);
  const { exec } = require("child_process");
  const open = process.platform === "win32" ? `start "" "${url}"`
             : process.platform === "darwin" ? `open "${url}"`
             : `xdg-open "${url}"`;
  exec(open);
}

// ── CLI ──
const args = process.argv.slice(2);

if (!args.length || args[0] === "-h" || args[0] === "--help") {
  usage();
  process.exit(0);
}
if (args[0] === "-V" || args[0] === "--version") {
  console.log(`hudsh ${VERSION}`);
  process.exit(0);
}

(async () => {
  try {
    switch (args[0]) {
      case "ls":
        await cmdLs();
        break;
      case "run":
        if (!args[1]) {
          console.error("ERR: hudsh run [page] <js>");
          process.exit(1);
        }
        if (!args[2]) {
          // hudsh run "code" — main process eval (no page specified)
          await cmdRunMain(args[1]);
        } else {
          // hudsh run <page> "code" — page eval
          await cmdRun(args[1], args.slice(2).join(" "));
        }
        break;
      case "kill":
        if (!args[1]) {
          console.error("ERR: hudsh kill <page>");
          process.exit(1);
        }
        await cmdKill(args[1]);
        break;
      case "status":
        if (!args[1]) {
          console.error("ERR: hudsh status <page>");
          process.exit(1);
        }
        await cmdStatus(args[1]);
        break;
      case "attach":
        if (!args[1]) {
          console.error("ERR: hudsh attach <page>");
          process.exit(1);
        }
        await cmdAttach(args[1]);
        break;
      default:
        usage();
    }
  } catch (e) {
    console.error(`ERR ${e.message}`);
    process.exit(1);
  }
})();
