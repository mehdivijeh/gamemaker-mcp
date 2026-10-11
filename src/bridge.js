// Node-side client for the in-game MCP bridge (raw TCP, newline-delimited
// JSON).
//
// The GML side runs a *raw* TCP server (network_create_server_raw) - raw
// servers skip GameMaker's built-in packet headers/login handshake, so plain
// TCP + newline framing works. Regular network_create_server sockets expect
// the undocumented "GM:Studio-Connect" login packet instead.
//
// Requests are ASCII-safe on the wire (non-ASCII characters are escaped as
// \uXXXX) because the GML side accumulates request bytes one by one.

import net from "node:net";

export function asciiSafeJson(obj) {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) => {
    return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
  });
}

export class BridgeClient {
  /**
   * @param {number} port
   * @param {string} [host]
   */
  constructor(port, host = "127.0.0.1") {
    this.port = port;
    this.host = host;
    this.socket = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject, timer}
  }

  get connected() {
    return this.socket !== null && !this.socket.destroyed;
  }

  /** Open the TCP connection. */
  connect(timeoutMs = 2500) {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ port: this.port, host: this.host });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(
          new Error(
            `Bridge connect timeout after ${timeoutMs}ms (port ${this.port}). Is the game running with the bridge?`,
          ),
        );
      }, timeoutMs);
      sock.on("connect", () => {
        clearTimeout(timer);
        this.socket = sock;
        resolve();
      });
      sock.on("error", (err) => {
        clearTimeout(timer);
        if (!this.socket) reject(err);
      });
      sock.on("close", () => this._onClose());
      sock.on("data", (data) => this._onData(data));
    });
  }

  _onData(data) {
    this.buffer += data.toString("utf8");
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // tolerate partial/garbled lines
      }
      const entry = this.pending.get(String(msg.id));
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(String(msg.id));
        entry.resolve(msg);
      }
    }
  }

  _onClose() {
    this.socket = null;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`Bridge connection closed while waiting for response ${id}`));
    }
    this.pending.clear();
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /**
   * Send one command and await its response.
   * @param {string} cmd e.g. "instances.list"
   * @param {object} [args]
   * @param {number} [timeoutMs]
   */
  async send(cmd, args = {}, timeoutMs = 8000) {
    if (!this.connected) await this.connect();
    const id = String(this.nextId++);
    const payload = asciiSafeJson({ id, cmd, args }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge command "${cmd}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(payload, "utf8", (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  ping() {
    return this.send("ping", {}, 3000);
  }

  info() {
    return this.send("info");
  }

  getGlobals(names) {
    return this.send("globals.get", { names });
  }

  setGlobals(values) {
    return this.send("globals.set", { values });
  }

  listInstances(args = {}) {
    return this.send("instances.list", args);
  }

  getInstance(id) {
    return this.send("instances.get", { id });
  }

  setInstance(id, values) {
    return this.send("instances.set", { id, values });
  }

  createInstance(object, x, y, extra = {}) {
    return this.send("instances.create", { object, x, y, ...extra });
  }

  destroyInstance(id) {
    return this.send("instances.destroy", { id });
  }

  changeRoom(room) {
    return this.send("rooms.change", { room });
  }

  callFunction(name, args = []) {
    return this.send("functions.call", { function: name, args });
  }

  evalCode(code) {
    return this.send("eval", { code });
  }

  screenshot(path) {
    return this.send("screenshot", { path }, 15000);
  }

  key(key, action = "press") {
    return this.send("keys", { key, action });
  }

  logs(since = 0) {
    return this.send("logs.get", { since });
  }

  setSpeed(fps) {
    return this.send("game.speed", { fps });
  }
}

/**
 * Try to connect to a running game bridge, scanning a range of ports
 * (the bridge increments the port if the preferred one is taken).
 * @returns {Promise<BridgeClient>}
 */
export async function connectToGame(port, tries = 8) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    const client = new BridgeClient(port + i);
    try {
      await client.connect(1200);
      const pong = await client.ping();
      if (pong && pong.pong) return client;
      client.close();
    } catch (err) {
      lastError = err;
      client.close();
    }
  }
  throw new Error(
    `Could not connect to a running game bridge on ports ${port}..${port + tries - 1}` +
      (lastError ? ` (last error: ${lastError.message})` : ""),
  );
}
