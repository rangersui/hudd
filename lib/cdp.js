/**
 * cdp.js — CDP client with token auth for hudd/hudsh
 *
 * Reads port + token from daemon.json.
 * All requests include Authorization: Bearer <token>.
 */

const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), "hudd");
const DAEMON_DIR = DATA_DIR;
const DAEMON_JSON = path.join(DATA_DIR, "daemon.json");

function getMeta() {
  if (fs.existsSync(DAEMON_JSON)) {
    try { return JSON.parse(fs.readFileSync(DAEMON_JSON, "utf-8")); } catch {}
  }
  return {};
}

function getPort() {
  const env = process.env.HUDD_PORT;
  if (env) return parseInt(env);
  const meta = getMeta();
  if (meta.port) return meta.port;
  return 9500;
}

function getToken() {
  return process.env.HUDD_TOKEN || getMeta().token || "";
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** GET /json — list all CDP targets (with auth) */
function cdpList(port) {
  port = port || getPort();
  return new Promise((resolve, reject) => {
    http
      .get({
        hostname: "127.0.0.1",
        port,
        path: "/json",
        headers: authHeaders(),
      }, (res) => {
        if (res.statusCode === 403) {
          reject(new Error("auth failed — check daemon.json token"));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
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

/** Runtime.evaluate over WebSocket (with auth) */
function cdpEval(wsUrl, expression, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers: authHeaders() });
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
      const resp = JSON.parse(raw.toString());
      if (resp.id !== 1) return;  // skip events, wait for our response
      clearTimeout(timer);
      ws.close();

      if (resp.error) {
        resolve({ error: resp.error.message || JSON.stringify(resp.error) });
        return;
      }
      const result = resp.result?.result;
      if (!result) { resolve(null); return; }
      if (result.subtype === "error") {
        resolve({ error: result.description || result.value || "unknown error" });
        return;
      }
      if ("value" in result) { resolve(result.value); return; }
      if (result.type === "undefined") { resolve(null); return; }
      resolve(result);
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Main process eval via POST /json/eval (with auth) */
function cdpMainEval(expression, port) {
  port = port || getPort();
  const body = JSON.stringify({ expression });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/json/eval",
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      if (res.statusCode === 403) {
        reject(new Error("auth failed — check daemon.json token"));
        return;
      }
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) resolve({ error: parsed.error });
          else if ("value" in parsed) resolve(parsed.value);
          else resolve(null);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", (e) => {
      reject(new Error(`cannot connect to daemon at 127.0.0.1:${port}: ${e.message}`));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { DAEMON_DIR, DAEMON_JSON, getPort, getToken, cdpList, findPage, cdpEval, cdpMainEval };
