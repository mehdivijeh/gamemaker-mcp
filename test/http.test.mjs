// Tests the streamable HTTP transport: spawns `node src/index.js --http 0`,
// reads the real port from stderr, then does initialize -> tools/list ->
// tools/call over HTTP with a session id (per the MCP spec).

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "..", "src", "index.js");

const child = spawn(process.execPath, [serverPath, "--http", "0"], { stdio: ["ignore", "pipe", "pipe"] });

function waitForUrl(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("timeout waiting for HTTP URL")), timeoutMs);
    child.stderr.on("data", (d) => {
      buf += d.toString("utf8");
      const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)\/mcp/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
  });
}

function fail(msg) {
  console.error("HTTP TEST FAIL:", msg);
  child.kill();
  process.exit(1);
}

const port = await waitForUrl();
console.log("http transport on port", port);

let sessionId = null;

async function rpc(method, params = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!sessionId && res.headers.get("mcp-session-id")) {
    sessionId = res.headers.get("mcp-session-id");
  }
  const text = await res.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  const jsonText = dataLine ? dataLine.slice(5).trim() : text;
  return { status: res.status, body: JSON.parse(jsonText), sessionId };
}

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "http-test", version: "0" },
});
if (!init.body.result?.serverInfo?.name) fail(`initialize: ${JSON.stringify(init.body)}`);
if (!init.sessionId) fail("no Mcp-Session-Id header on initialize response");
console.log("initialize ok:", init.body.result.serverInfo.name, "session:", sessionId.slice(0, 8) + "...");

await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "Mcp-Session-Id": sessionId,
  },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
});

const tools = await rpc("tools/list", {});
const names = (tools.body.result?.tools ?? []).map((t) => t.name);
if (names.length < 40) fail(`expected >= 40 tools, got ${names.length}`);
console.log(`tools/list ok: ${names.length} tools`);

const info = await rpc("tools/call", { name: "gm_runtime_info", arguments: {} });
const text = info.body.result?.content?.[0]?.text ?? "";
if (!text.includes("igorPath")) fail(`gm_runtime_info: ${text.slice(0, 200)}`);
console.log("gm_runtime_info ok over HTTP");

// requests without a session must be rejected cleanly
const noSession = await fetch(`http://127.0.0.1:${port}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} }),
});
if (noSession.status !== 400) fail(`expected 400 for session-less request, got ${noSession.status}`);
console.log("session enforcement ok");

child.kill();
console.log("HTTP transport test PASSED");
process.exit(0);
