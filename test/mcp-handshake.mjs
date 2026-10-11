// Speaks the MCP stdio protocol to the server and verifies initialize,
// tools/list and a couple of tool calls (no GameMaker required).

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "..", "src", "index.js");

const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function request(method, params = {}, timeoutMs = 15000) {
  const id = nextId++;
  const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(payload + "\n");
  });
}

function notify(method, params = {}) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function fail(msg) {
  console.error("HANDSHAKE FAIL:", msg);
  child.kill();
  process.exit(1);
}

const init = await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "handshake-test", version: "0.0.1" },
});
if (!init.result?.serverInfo?.name) fail(`initialize failed: ${JSON.stringify(init)}`);
console.log("initialize ok:", init.result.serverInfo.name, init.result.protocolVersion ?? "");
notify("notifications/initialized");

const tools = await request("tools/list", {});
const names = (tools.result?.tools ?? []).map((t) => t.name);
if (names.length < 30) fail(`expected >= 30 tools, got ${names.length}: ${names.join(",")}`);
console.log(`tools/list ok: ${names.length} tools`);

const required = [
  "gm_open_project",
  "gm_create_project",
  "gm_close_project",
  "gm_write_gml",
  "gm_set_object_event",
  "gm_get_object",
  "gm_set_object_properties",
  "gm_get_room",
  "gm_set_room_properties",
  "gm_set_first_room",
  "gm_inject_bridge",
  "gm_build",
  "gm_run_game",
  "gm_bridge_screenshot",
  "gm_bridge_set_globals",
  "gm_bridge_restart_room",
  "gm_bridge_restart_game",
  "gm_bridge_set_mouse",
];
for (const r of required) {
  if (!names.includes(r)) fail(`missing tool ${r}`);
}

const info = await request("tools/call", { name: "gm_runtime_info", arguments: {} });
const infoText = info.result?.content?.[0]?.text ?? "";
if (!infoText.includes("igorPath")) fail(`gm_runtime_info unexpected: ${infoText.slice(0, 200)}`);
console.log("gm_runtime_info ok:", JSON.parse(infoText).igorPath);

const projects = await request("tools/call", { name: "gm_list_projects", arguments: {} });
const projectList = JSON.parse(projects.result?.content?.[0]?.text ?? "[]");
if (!Array.isArray(projectList) || projectList.length === 0) fail("gm_list_projects returned nothing");
console.log(`gm_list_projects ok: ${projectList.length} projects found`);

const badCall = await request("tools/call", { name: "gm_project_summary", arguments: {} });
if (!badCall.result?.isError) fail("gm_project_summary without open project should be an error");
console.log("error handling ok");

child.kill();
console.log("MCP handshake test PASSED");
process.exit(0);
