/**
 * gateway.js — CDP auth gateway (pipe → authenticated TCP)
 *
 * Electron runs with --remote-debugging-pipe (no TCP port).
 * This gateway opens a TCP port with token auth, multiplexes
 * client WebSocket connections onto the single pipe via
 * Target.attachToTarget({flatten: true}).
 *
 * Security model same as pythond: token in daemon.json,
 * directory DACL on Windows, chmod 700 on POSIX.
 */

"use strict";

const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

class CDPGateway {
  constructor({ pipeWrite, pipeRead, proc, port, token, onReady }) {
    this.pipeWrite = pipeWrite;   // Writable — send commands to Chrome fd 3
    this.pipeRead = pipeRead;     // Readable — receive from Chrome fd 4
    this.proc = proc;             // Child process — IPC for main eval
    this.port = port;
    this.token = token;

    this._nextId = 1000000;       // high range, avoids collision with client ids
    this._pending = new Map();    // id → { resolve, reject, timer }
    this._evalPending = new Map(); // id → { resolve, timer } — main eval
    this._sessions = new Map();   // sessionId → WebSocket
    this._wsSession = new Map();  // WebSocket → sessionId

    this._buf = "";
    this._server = null;

    this._setupPipe();
    this._setupIPC();
    this._startServer(onReady);
  }

  // ── Pipe I/O ──────────────────────────────────────────

  _setupPipe() {
    this.pipeRead.setEncoding("utf-8");
    this.pipeRead.on("data", (chunk) => {
      this._buf += chunk;
      let idx;
      while ((idx = this._buf.indexOf("\0")) !== -1) {
        const json = this._buf.slice(0, idx);
        this._buf = this._buf.slice(idx + 1);
        if (json) {
          try { this._dispatch(JSON.parse(json)); } catch {}
        }
      }
    });
    this.pipeRead.on("error", () => this.close());
    this.pipeRead.on("end", () => this.close());
  }

  _setupIPC() {
    if (!this.proc) return;
    this.proc.on("message", (msg) => {
      if (msg?.type === "main-eval-result" && this._evalPending.has(msg.id)) {
        const { resolve, timer } = this._evalPending.get(msg.id);
        clearTimeout(timer);
        this._evalPending.delete(msg.id);
        resolve(msg);
      }
    });
  }

  mainEval(code, timeout = 30000) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      if (!this.proc) { reject(new Error("no IPC channel")); return; }
      const timer = setTimeout(() => {
        this._evalPending.delete(id);
        reject(new Error("timeout"));
      }, timeout);
      this._evalPending.set(id, { resolve, timer });
      this.proc.send({ type: "main-eval", id, code });
    });
  }

  _pipeSend(method, params = {}, sessionId) {
    const id = this._nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, 10000);
      this._pending.set(id, { resolve, reject, timer });
      this.pipeWrite.write(JSON.stringify(msg) + "\0");
    });
  }

  _dispatch(msg) {
    // Session-level message → route to client WebSocket
    if (msg.sessionId) {
      const ws = this._sessions.get(msg.sessionId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        const fwd = { ...msg };
        delete fwd.sessionId;
        ws.send(JSON.stringify(fwd));
      }
      return;
    }
    // Gateway command response (no sessionId)
    if (msg.id != null && this._pending.has(msg.id)) {
      const { resolve, timer } = this._pending.get(msg.id);
      clearTimeout(timer);
      this._pending.delete(msg.id);
      resolve(msg);
      return;
    }
    // Browser-level event — ignore
  }

  // ── Auth ──────────────────────────────────────────────

  _checkAuth(req) {
    if (!this.token) return false;  // empty token = deny all

    // Authorization: Bearer <token>
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Bearer ")) {
      const candidate = auth.slice(7);
      if (candidate.length === this.token.length &&
          crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(this.token))) {
        return true;
      }
    }
    // ?token=<token> in URL (for Chrome DevTools WebSocket)
    try {
      const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
      const qt = url.searchParams.get("token") || "";
      if (qt.length > 0 && qt.length === this.token.length &&
          crypto.timingSafeEqual(Buffer.from(qt), Buffer.from(this.token))) {
        return true;
      }
    } catch {}
    return false;
  }

  // ── Public query ──────────────────────────────────────

  async getTargets() {
    const result = await this._pipeSend("Target.getTargets");
    return (result.result?.targetInfos || []).filter(t => t.type === "page");
  }

  // ── HTTP endpoints ────────────────────────────────────

  async _handleHttp(req, res) {
    if (!this._checkAuth(req)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("forbidden\n");
      return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
    const p = url.pathname;

    try {
      if (p === "/json" || p === "/json/list") {
        const targets = await this.getTargets();
        const list = targets.map(t => ({
          id: t.targetId,
          type: t.type,
          title: t.title,
          url: t.url,
          webSocketDebuggerUrl:
            `ws://127.0.0.1:${this.port}/devtools/page/${t.targetId}`,
          devtoolsFrontendUrl:
            `devtools://devtools/bundled/inspector.html?ws=` +
            `127.0.0.1:${this.port}/devtools/page/${t.targetId}` +
            `?token=${this.token}`,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(list));

      } else if (p === "/json/version") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ Browser: "hudd/0.1.0", "Protocol-Version": "1.3" }));

      } else if (p === "/json/eval" && req.method === "POST") {
        let body = "";
        await new Promise((r) => { req.on("data", (c) => body += c); req.on("end", r); });
        const { expression } = JSON.parse(body);
        if (!expression) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "missing expression" }));
          return;
        }
        const result = await this.mainEval(expression);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(
          result.error ? { error: result.error }
          : "value" in result ? { value: result.value }
          : {}
        ));

      } else if (p.startsWith("/json/close/")) {
        const targetId = p.slice("/json/close/".length);
        await this._pipeSend("Target.closeTarget", { targetId });
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Target is closing\n");

      } else {
        res.writeHead(404);
        res.end("not found\n");
      }
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`error: ${e.message}\n`);
    }
  }

  // ── WebSocket multiplex ───────────────────────────────

  async _handleWs(ws, req) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
    const match = url.pathname.match(/^\/devtools\/page\/(.+)$/);
    if (!match) {
      ws.close(1008, "invalid path");
      return;
    }
    const targetId = match[1];

    // Buffer messages that arrive before attach completes
    const queue = [];
    ws.on("message", (raw) => queue.push(raw));

    try {
      const result = await this._pipeSend("Target.attachToTarget", {
        targetId, flatten: true,
      });
      if (result.error) {
        ws.close(1011, `attach failed: ${JSON.stringify(result.error)}`);
        return;
      }
      const sessionId = result.result?.sessionId;
      if (!sessionId) {
        ws.close(1011, "no sessionId");
        return;
      }

      this._sessions.set(sessionId, ws);
      this._wsSession.set(ws, sessionId);

      // Replace buffer handler with real forwarding
      const forward = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          msg.sessionId = sessionId;
          this.pipeWrite.write(JSON.stringify(msg) + "\0");
        } catch {}
      };
      ws.removeAllListeners("message");
      ws.on("message", forward);

      // Flush queued messages
      for (const raw of queue) forward(raw);

      ws.on("close", () => {
        this._sessions.delete(sessionId);
        this._wsSession.delete(ws);
        this._pipeSend("Target.detachFromTarget", { sessionId }).catch(() => {});
      });

    } catch (e) {
      ws.close(1011, `attach error: ${e.message}`);
    }
  }

  // ── Server ────────────────────────────────────────────

  _startServer(onReady) {
    this._server = http.createServer((req, res) => this._handleHttp(req, res));
    const wss = new WebSocket.Server({ noServer: true });

    this._server.on("upgrade", (req, socket, head) => {
      if (!this._checkAuth(req)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this._handleWs(ws, req));
    });

    this._server.listen(this.port, "127.0.0.1", () => {
      if (onReady) onReady();
    });
  }

  close() {
    for (const ws of this._sessions.values()) {
      try { ws.close(); } catch {}
    }
    this._sessions.clear();
    this._wsSession.clear();
    for (const { reject, timer } of this._pending.values()) {
      clearTimeout(timer);
      reject(new Error("gateway closed"));
    }
    this._pending.clear();
    for (const { resolve, timer } of this._evalPending.values()) {
      clearTimeout(timer);
      resolve({ error: "gateway closed" });
    }
    this._evalPending.clear();
    if (this._server) { this._server.close(); this._server = null; }
  }
}

module.exports = { CDPGateway };
