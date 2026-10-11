// END-TO-END test: drives the MCP server exactly like an AI client would
// against the real GameMaker install:
//   gm_open_project -> gm_inject_bridge -> gm_build -> gm_run_game ->
//   live bridge commands -> screenshot -> gm_stop_game
//
// Requires: GameMaker LTS 2026 + runtime on macOS (see gm_runtime_info).
// Run:  node test/e2e-gamemaker.mjs [sourceProjectDir]
//
// The source project is copied to /tmp/gm_e2e so your projects stay untouched.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readYY, writeYY } from "../src/yy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "..", "src", "index.js");
const srcProject = process.argv[2] ?? path.join(os.homedir(), "GameMakerProjects", "simple_platformer");
const workRoot = "/tmp/gm_e2e";
const projectDir = path.join(workRoot, "probe_game");

const log = (...a) => console.log("[e2e]", ...a);

/* ---------------- prepare a clean copy of the project ---------------- */
fs.rmSync(workRoot, { recursive: true, force: true });
fs.mkdirSync(workRoot, { recursive: true });
fs.cpSync(srcProject, projectDir, { recursive: true });
log("copied", srcProject, "->", projectDir);

// strip the old probe object (it calls game_end()) if present
const yypPath = path.join(projectDir, fs.readdirSync(projectDir).filter((f) => f.endsWith(".yyp"))[0]);
{
  const yyp = readYY(yypPath);
  yyp.resources = (yyp.resources ?? []).filter((r) => r.id.name !== "obj_mcp_probe");
  writeYY(yypPath, yyp);
  fs.rmSync(path.join(projectDir, "objects", "obj_mcp_probe"), { recursive: true, force: true });
  const roomFile = path.join(projectDir, "rooms", "Room1", "Room1.yy");
  if (fs.existsSync(roomFile)) {
    const room = readYY(roomFile);
    for (const layer of room.layers ?? []) {
      if (layer.instances) {
        layer.instances = layer.instances.filter((i) => i.objectId?.name !== "obj_mcp_probe");
      }
    }
    room.instanceCreationOrder = (room.instanceCreationOrder ?? []).filter((i) => !/MCPPROB/i.test(i.name));
    writeYY(roomFile, room);
  }
}

/* ---------------- MCP client plumbing ---------------- */
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

function request(method, params = {}, timeoutMs = 300000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

async function callTool(name, args = {}) {
  const res = await request("tools/call", { name, arguments: args });
  if (res.error) throw new Error(`${name}: protocol error ${JSON.stringify(res.error)}`);
  if (res.result?.isError) {
    const text = res.result.content?.map((c) => c.text ?? c.type).join("\n");
    throw new Error(`${name} failed:\n${text}`);
  }
  return res.result;
}

function toolJson(result) {
  const textBlock = result.content?.find((c) => c.type === "text");
  return textBlock ? JSON.parse(textBlock.text) : undefined;
}

let failures = 0;
async function step(name, fn) {
  process.stdout.write(`[e2e] ${name} ... `);
  try {
    const out = await fn();
    console.log("OK");
    return out;
  } catch (e) {
    failures++;
    console.log("FAILED:", e.message);
    return undefined;
  }
}

/* ---------------- the run ---------------- */
await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "e2e", version: "0" },
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

await step("gm_open_project", async () => {
  const s = toolJson(await callTool("gm_open_project", { path: yypPath }));
  if (!s.name) throw new Error(`unexpected summary ${JSON.stringify(s)}`);
  log("   project:", s.name, JSON.stringify(s.counts));
});

await step("gm_inject_bridge", async () => {
  log("   ", JSON.stringify(toolJson(await callTool("gm_inject_bridge", {}))));
});

await step("gm_build", async () => {
  const b = toolJson(await callTool("gm_build", {}));
  log("   ", JSON.stringify({ ok: b.ok, errors: b.errors?.length, stats: b.stats }));
  if (!b.ok) throw new Error(`build not ok: ${JSON.stringify(b.errors ?? String(b.logTail).slice(-400))}`);
});

const runOut = await step("gm_run_game", async () => {
  const info = toolJson(await callTool("gm_run_game", {}));
  log("   bridge port:", info.bridgePort, "room:", info.info?.room);
  if (!info.ok) throw new Error("run reported not ok");
  return info;
});

if (runOut) {
  await step("gm_bridge_info", async () => {
    const info = toolJson(await callTool("gm_bridge_info", {}));
    log("   room:", info.room, "instances:", info.instances, "fps:", info.fps, "saveArea:", info.saveArea);
    if (!info.room) throw new Error("no room in info");
  });

  await step("gm_bridge_set_globals + get_globals", async () => {
    await callTool("gm_bridge_set_globals", { values: { mcp_e2e_check: 42, mcp_e2e_text: "héllo bridge" } });
    const v = toolJson(await callTool("gm_bridge_get_globals", { names: ["mcp_e2e_check", "mcp_e2e_text"] })).values;
    if (v.mcp_e2e_check !== 42) throw new Error(`global not set: ${JSON.stringify(v)}`);
    if (v.mcp_e2e_text !== "héllo bridge") throw new Error(`unicode global wrong: ${JSON.stringify(v)}`);
    log("   round-trip ok (incl. unicode)");
  });

  await step("gm_bridge_create/list/destroy instance", async () => {
    const created = toolJson(await callTool("gm_bridge_create_instance", { object: "obj_mcp_bridge", x: 12, y: 34 }));
    if (typeof created.instance !== "number" || created.instance < 0) {
      throw new Error(`create failed: ${JSON.stringify(created)}`);
    }
    const list = toolJson(await callTool("gm_bridge_list_instances", { object: "obj_mcp_bridge", fields: ["x", "y"] }));
    if (!list.instances.some((i) => i.id === created.instance)) throw new Error("created instance not in list");
    await callTool("gm_bridge_destroy_instance", { id: created.instance });
    const list2 = toolJson(await callTool("gm_bridge_list_instances", { object: "obj_mcp_bridge" }));
    if (list2.instances.some((i) => i.id === created.instance)) throw new Error("instance not destroyed");
    log(`   created instance=${created.instance}, destroyed`);
  });

  await step("gm_bridge_call + logs", async () => {
    await callTool("gm_bridge_call", { function: "mcp_bridge_log", args: ["e2e call"] });
    const logs = toolJson(await callTool("gm_bridge_logs", {}));
    if (!logs.logs.some((l) => String(l).includes("e2e call"))) {
      throw new Error(`log line missing: ${JSON.stringify(logs).slice(0, 300)}`);
    }
    log("   function call + logs ok");
  });

  await step("gm_bridge_key", async () => {
    await callTool("gm_bridge_key", { key: "space", action: "press" });
    await callTool("gm_bridge_key", { key: "space", action: "release" });
    log("   key injection ok");
  });

  await step("gm_bridge_screenshot", async () => {
    const r = await callTool("gm_bridge_screenshot", {});
    const img = r.content?.find((c) => c.type === "image");
    if (!img) throw new Error("no image content block");
    const size = Buffer.from(img.data, "base64").length;
    if (size < 1000) throw new Error(`suspiciously small png: ${size} bytes`);
    log(`   received PNG (${size} bytes)`);
  });
}

await step("gm_stop_game", async () => {
  log("   ", JSON.stringify(toolJson(await callTool("gm_stop_game", {}))));
});

child.kill();
console.log(failures === 0 ? "\nE2E PASSED" : `\nE2E FINISHED WITH ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
