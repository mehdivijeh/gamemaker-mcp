#!/usr/bin/env node
// ============================================================================
//  gamemaker-mcp LIVE DEMO
// ----------------------------------------------------------------------------
//  Builds a tiny GameMaker project from scratch *through the MCP tools* and
//  then plays with it while it runs:
//
//    files      gm_create_script / gm_create_object / gm_set_object_event /
//               gm_create_room / gm_add_instance / gm_search_gml ...
//    build+run  gm_build (Igor) / gm_run_game
//    live       gm_bridge_list_instances / set_globals / call / keys /
//               screenshot / logs / stop
//
//  Run:    node demo/mcp-demo.mjs
//  Output: a real project at ~/GameMakerProjects/MCP Demo
//          screenshots in demo/shots/
// ============================================================================

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readYY, writeYY } from "../src/yy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "..", "src", "index.js");
const SKELETON = path.join(os.homedir(), "GameMakerProjects", "simple_platformer");
const DEMO_DIR = path.join(os.homedir(), "GameMakerProjects", "MCP Demo");
const SHOT_DIR = path.join(__dirname, "shots");
const PROJECT_NAME = "MCP Demo";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
let stepNo = 0;
const failures = [];

/* ---------------- 1. project skeleton on disk ---------------- */
function prepareProject() {
  if (path.basename(DEMO_DIR) !== PROJECT_NAME) throw new Error(`refusing to delete ${DEMO_DIR}`);
  fs.rmSync(DEMO_DIR, { recursive: true, force: true });
  fs.cpSync(SKELETON, DEMO_DIR, { recursive: true });
  fs.rmSync(path.join(DEMO_DIR, ".DS_Store"), { force: true });

  const oldYyp = path.join(DEMO_DIR, "simple_platformer.yyp");
  const newYyp = path.join(DEMO_DIR, `${PROJECT_NAME}.yyp`);
  const yyp = readYY(oldYyp);
  yyp["%Name"] = PROJECT_NAME;
  yyp.name = PROJECT_NAME;
  writeYY(newYyp, yyp);
  fs.rmSync(oldYyp, { force: true });

  const oldOrder = path.join(DEMO_DIR, "simple_platformer.resource_order");
  if (fs.existsSync(oldOrder)) {
    fs.renameSync(oldOrder, path.join(DEMO_DIR, `${PROJECT_NAME}.resource_order`));
  }
  return newYyp;
}

/* ---------------- 2. MCP client plumbing ---------------- */
const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
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

async function tool(name, args = {}) {
  const res = await request("tools/call", { name, arguments: args });
  if (res.error) throw new Error(`${name}: ${JSON.stringify(res.error)}`);
  if (res.result?.isError) {
    const text = res.result.content?.map((c) => c.text ?? c.type).join("\n");
    throw new Error(`${name} failed:\n${text}`);
  }
  return res.result;
}

const toolJson = (result) => {
  const t = result.content?.find((c) => c.type === "text");
  if (!t) return undefined;
  try {
    return JSON.parse(t.text);
  } catch {
    return t.text;
  }
};

async function step(label, fn) {
  stepNo++;
  const t0 = Date.now();
  process.stdout.write(`\n▸ ${String(stepNo).padStart(2)}. ${label} ... `);
  try {
    const out = await fn();
    log(`ok (${Date.now() - t0}ms)`);
    return out;
  } catch (e) {
    log(`FAILED (${Date.now() - t0}ms)`);
    log(`   ${String(e.message).split("\n")[0]}`);
    failures.push(label);
    return undefined;
  }
}

async function screenshot(label) {
  const res = await tool("gm_bridge_screenshot", {});
  const img = res.content?.find((c) => c.type === "image");
  const txt = res.content?.find((c) => c.type === "text");
  const data = Buffer.from(img.data, "base64");
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, label);
  fs.copyFileSync(txt.text, file);
  const hash = crypto.createHash("sha1").update(data).digest("hex").slice(0, 10);
  log(`   📸 ${file} (${data.length} bytes, sha1 ${hash})`);
  return { file, size: data.length, hash };
}

/* ---------------- 3. the little game we build ---------------- */
const GML = {
  script: `/// MCP demo helpers - callable live over the bridge

/// demo_boost(amount)
/// Temporarily speeds the demo ball up (max +10).
function demo_boost(_amount) {
    global.mcp_demo_boost = min(global.mcp_demo_boost + _amount, 10);
}

/// demo_speed_set(value)
/// Sets the base speed of the demo ball (1..12).
function demo_speed_set(_value) {
    global.mcp_demo_speed = clamp(_value, 1, 12);
}
`,

  create: `/// @desc MCP demo ball - live-controllable through the MCP bridge
randomize();
global.mcp_demo_bounces = 0;
global.mcp_demo_speed   = 3;
global.mcp_demo_boost   = 0;

dirx = choose(-1, 1);
diry = choose(-1, 1);
image_speed = 0;
`,

  step: `/// @desc bounce off the walls, honour live speed settings
var _spd = global.mcp_demo_speed + global.mcp_demo_boost;

x += dirx * _spd;
y += diry * _spd;

if (x <= 0) {
    x = 0;
    dirx = 1;
    global.mcp_demo_bounces += 1;
} else if (x >= room_width - sprite_width) {
    x = room_width - sprite_width;
    dirx = -1;
    global.mcp_demo_bounces += 1;
}

if (y <= 0) {
    y = 0;
    diry = 1;
    global.mcp_demo_bounces += 1;
} else if (y >= room_height - sprite_height) {
    y = room_height - sprite_height;
    diry = -1;
    global.mcp_demo_bounces += 1;
}

// boost decays over time
if (global.mcp_demo_boost > 0) {
    global.mcp_demo_boost = max(0, global.mcp_demo_boost - 0.05);
}
`,

  keypress: `demo_boost(4);
`,

  drawgui: `draw_set_colour(c_white);
draw_text(16, 16, "MCP Demo  -  bounces: " + string(global.mcp_demo_bounces));
draw_text(16, 36, "speed: " + string(global.mcp_demo_speed) + "   live boost: " + string(global.mcp_demo_boost));
draw_text(16, 56, "SPACE = boost  (or call demo_boost() over the bridge)");
draw_text(16, 76, "room: " + room_get_name(room) + "   fps: " + string(fps));
`,
};

/* ---------------- 4. the demo ---------------- */
log("================================================================");
log("  gamemaker-mcp live demo - building a tiny game through MCP tools");
log("================================================================");

const yypPath = prepareProject();
log(`\nproject skeleton: ${yypPath}`);

await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "mcp-demo", version: "0" },
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

await step("gm_open_project", async () => {
  const s = toolJson(await tool("gm_open_project", { path: yypPath }));
  log(`   project "${s.name}" (${JSON.stringify(s.counts)})`);
});

await step("gm_delete_resource Room1 (fresh start)", () => tool("gm_delete_resource", { name: "Room1" }));

await step("gm_create_room rm_demo 800x600 (first room)", async () => {
  await tool("gm_create_room", { name: "rm_demo", width: 800, height: 600, first: true });
});

await step("gm_create_script scr_demo_util", () =>
  tool("gm_create_script", { name: "scr_demo_util", content: GML.script }),
);

await step("gm_create_object obj_ball (sprite sPlayer)", () =>
  tool("gm_create_object", { name: "obj_ball", sprite: "sPlayer" }),
);

await step("gm_set_object_event obj_ball: Create / Step / Draw GUI / KeyPress Space", async () => {
  for (const [event, code] of [
    ["Create", GML.create],
    ["Step", GML.step],
    ["Draw GUI", GML.drawgui],
    ["KeyPress:32", GML.keypress],
  ]) {
    const r = toolJson(await tool("gm_set_object_event", { object: "obj_ball", event, code }));
    log(`   ${event.padEnd(14)} -> ${r.file}`);
  }
});

await step('gm_search_gml "mcp_demo_speed"', async () => {
  const r = toolJson(await tool("gm_search_gml", { pattern: "mcp_demo_speed" }));
  log(`   ${r.matches} matches in ${[...new Set(r.hits.map((h) => h.resource))].join(", ")}`);
});

await step("gm_read_gml obj_ball Step (excerpt)", async () => {
  const r = await tool("gm_read_gml", { name: "obj_ball", event: "Step" });
  log(`   ${r.content[0].text.split("\n").slice(0, 3).join(" / ")} ...`);
});

await step("gm_add_instance rm_demo obj_ball @400,300", async () => {
  const r = toolJson(await tool("gm_add_instance", { room: "rm_demo", object: "obj_ball", x: 400, y: 300 }));
  log(`   ${typeof r === "string" ? r : r.instance}`);
});

await step("gm_inject_bridge", async () => {
  const r = toolJson(await tool("gm_inject_bridge", {}));
  log(`   ${r.script} + ${r.object} -> ${r.firstRoom}`);
});

await step("gm_build (Igor release build)", async () => {
  const b = toolJson(await tool("gm_build", {}));
  log(`   ok=${b.ok} errors=${b.errors.length} attempts=${b.attempts ?? 1} ${b.stats ?? ""}`);
  if (!b.ok) throw new Error(String(b.logTail).slice(-300));
});

await step("gm_run_game (launch + auto-connect bridge)", async () => {
  const r = toolJson(await tool("gm_run_game", { skipBuild: true }));
  log(`   pid=${r.pid} bridge=127.0.0.1:${r.bridgePort} room=${r.info.room} fps=${r.info.fps}`);
});

const shot1 = await step("gm_bridge_screenshot (baseline)", () => screenshot("shot1_start.png"));

await step("gm_bridge_get_globals", async () => {
  const r = toolJson(await tool("gm_bridge_get_globals", { names: ["mcp_demo_bounces", "mcp_demo_speed"] }));
  log(`   ${JSON.stringify(r.values)}`);
});

await step("gm_bridge_set_globals speed -> 9", async () => {
  await tool("gm_bridge_set_globals", { values: { mcp_demo_speed: 9 } });
  const r = toolJson(await tool("gm_bridge_get_globals", { names: ["mcp_demo_speed"] }));
  log(`   live speed is now ${r.values.mcp_demo_speed}`);
});

await step("gm_bridge_call demo_boost(5)", async () => {
  await tool("gm_bridge_call", { function: "demo_boost", args: [5] });
  const r = toolJson(await tool("gm_bridge_get_globals", { names: ["mcp_demo_boost"] }));
  log(`   boost applied live: ${r.values.mcp_demo_boost}`);
});

const ballId = await step("gm_bridge_list_instances obj_ball (live position)", async () => {
  const r = toolJson(
    await tool("gm_bridge_list_instances", { object: "obj_ball", fields: ["x", "y", "dirx", "diry"] }),
  );
  const b = r.instances[0];
  log(`   id=${b.id} x=${Math.round(b.x)} y=${Math.round(b.y)} dir=(${b.dirx},${b.diry})`);
  return b?.id;
});

const shot2 = await step("gm_bridge_screenshot (after live changes)", async () => {
  await sleep(1200); // let it speed around
  return screenshot("shot2_boosted.png");
});

await step("gm_bridge_set_instance (teleport ball to 60,60)", async () => {
  if (!ballId) throw new Error("no ball id");
  await tool("gm_bridge_set_instance", { id: ballId, values: { x: 60, y: 60 } });
  log(`   instance ${ballId} moved`);
});

await step("gm_bridge_key space (press + release)", async () => {
  await tool("gm_bridge_key", { key: "space", action: "press" });
  await tool("gm_bridge_key", { key: "space", action: "release" });
  log("   boost triggered by key injection");
});

const shot3 = await step("gm_bridge_screenshot (after teleport + key boost)", async () => {
  await sleep(1500);
  return screenshot("shot3_after_keyboost.png");
});

await step("gm_bridge_logs", async () => {
  const r = toolJson(await tool("gm_bridge_logs", {}));
  log(`   ${r.total} log entries - last: "${r.logs[r.logs.length - 1]}"`);
});

await step("gm_stop_game", async () => {
  const r = toolJson(await tool("gm_stop_game", {}));
  log(`   killed ${r.killed} process`);
});

child.kill();

/* ---------------- summary ---------------- */
log("\n================================================================");
if (failures.length === 0) {
  log("  DEMO FINISHED - every step succeeded");
} else {
  log(`  DEMO FINISHED with ${failures.length} failure(s): ${failures.join(", ")}`);
}
log("================================================================");
log(`\nproject    : ${DEMO_DIR}`);
log(`screenshots: ${SHOT_DIR}`);
if (shot1 && shot2 && shot3) {
  log(`\nshot1 start       : ${shot1.size} bytes (sha1 ${shot1.hash})`);
  log(`shot2 live-changed: ${shot2.size} bytes (sha1 ${shot2.hash})`);
  log(`shot3 after key   : ${shot3.size} bytes (sha1 ${shot3.hash})`);
  const proves = shot1.hash !== shot2.hash && shot2.hash !== shot3.hash;
  log(`\nproof of live control: screenshots differ -> ${proves ? "YES" : "no"}`);
}
process.exit(failures.length === 0 ? 0 : 1);
