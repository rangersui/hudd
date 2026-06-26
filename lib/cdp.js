/**
 * cdp.js — CDP HTTP + WebSocket helpers for hudd/hudsh
 */

const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const os = require("os");

const LOCALAPPDATA = process.env.LOCALAPPDATA || os.homedir();
const DAEMON_DIR = path.join(LOCALAPPDATA, "hudd");
const DAEMON_JSON = path.join(DAEMON_DIR, "daemon.json");

function getPort() {
  const env = process.env.ELECTROND_PORT;
  if (env) return parseInt(env);
  if (fs.existsSync(DAEMON_JSON)) {
    return JSON.parse(fs.readFileSync(DAEMON_JSON, "utf-8")).port;
  }
  return 9500;
}

/** GET /json — list all CDP targets */
function cdpList(port) {
  port = port || getPort();
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/json`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", (e) => {
        reject(new Error(`cannot connect to CDP at 127.0.0.1:${port}: ${e.message}`));
      });
  });
}

/** Find a page by title (case-insensitive partial match) */
function findPage(name, targets) {
  const lower = name.toLowerCase();
  return (
    targets.find((t) => t.title?.toLowerCase() === lower && t.type === "page") ||
    targets.find((t) => t.title?.toLowerCase().includes(lower) && t.type === "page") ||
    targets.find((t) => t.title?.toLowerCase().includes(lower)) ||
    null
  );
}

/** Runtime.evaluate over WebSocket */
function cdpEval(wsUrl, expression, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("timeout"));
    }, timeout);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            returnByValue: true,
            awaitPromise: true,
            userGesture: true,
          },
        })
      );
    });

    ws.on("message", (raw) => {
      clearTimeout(timer);
      const resp = JSON.parse(raw.toString());
      ws.close();

      if (resp.error) {
        resolve({ error: resp.error.message || JSON.stringify(resp.error) });
        return;
      }

      const result = resp.result?.result;
      if (!result) {
        resolve(null);
        return;
      }
      if (result.subtype === "error") {
        resolve({ error: result.description || result.value || "unknown error" });
        return;
      }
      if ("value" in result) {
        resolve(result.value);
        return;
      }
      if (result.type === "undefined") {
        resolve(null);
        return;
      }
      resolve(result);
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

module.exports = { DAEMON_DIR, DAEMON_JSON, getPort, cdpList, findPage, cdpEval };
