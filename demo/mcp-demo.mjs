#!/usr/bin/env node
// ============================================================================
//  gamemaker-mcp LIVE DEMO: "CYBER SURGE // MCP ARENA"
// ----------------------------------------------------------------------------
//  Builds a rich, visually stunning retro-cyber arcade game from scratch
//  *through the MCP tools* and then interacts with it live over the TCP bridge:
//
//    files      gm_create_script / gm_create_object / gm_set_object_event /
//               gm_create_room / gm_add_instance / gm_search_gml ...
//    build+run  gm_build (Igor) / gm_run_game
//    live       gm_bridge_list_instances / set_globals / call / keys /
//               screenshot / logs / stop
//
//  Run:    node demo/mcp-demo.mjs
//  Output: project at ~/GameMakerProjects/MCP Demo
//          screenshots in demo/shots/ and docs/images/
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
const DOCS_IMG_DIR = path.join(__dirname, "..", "docs", "images");
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

/* ---------------- 3. GML source for "Cyber Surge: MCP Arena" ---------------- */
const GML = {
  script: `/// scr_demo_util - callable live over the GameMaker MCP bridge

/// demo_boost(amount)
/// Temporarily increases speed and fires laser barrage
function demo_boost(_amount) {
    global.mcp_demo_boost = min(global.mcp_demo_boost + _amount, 12);
    global.mcp_score += 750 * _amount;
}

/// demo_speed_set(value)
/// Sets the base player cruise speed (1..15)
function demo_speed_set(_value) {
    global.mcp_demo_speed = clamp(_value, 1, 15);
}

/// demo_overdrive(enabled)
/// Toggles overdrive surge mode with accelerated particles and 8x multiplier
function demo_overdrive(_enabled) {
    if (_enabled) {
        global.mcp_overdrive = 100;
        global.mcp_multiplier = 8.0;
        global.mcp_status_text = "OVERDRIVE SURGE ACTIVATED";
    } else {
        global.mcp_overdrive = 0;
        global.mcp_multiplier = 4.0;
        global.mcp_status_text = "AI BRIDGE CONNECTED";
    }
}

/// demo_add_score(amount)
function demo_add_score(_amount) {
    global.mcp_score += _amount;
}
`,

  gameCreate: `/// obj_game: Create
randomize();
global.mcp_score        = 48250;
global.mcp_multiplier   = 4.0;
global.mcp_overdrive    = 0;
global.mcp_demo_boost   = 0;
global.mcp_demo_speed   = 4;
global.mcp_bounces      = 0;
global.mcp_status_text  = "AI BRIDGE CONNECTED";

grid_y = 0;

// Parallax cyber starfield
star_count = 50;
star_x = array_create(star_count, 0);
star_y = array_create(star_count, 0);
star_spd = array_create(star_count, 0);
star_size = array_create(star_count, 1);
star_col = array_create(star_count, c_white);

for (var i = 0; i < star_count; i++) {
    star_x[i] = random(800);
    star_y[i] = random(600);
    star_spd[i] = random_range(1.0, 4.5);
    star_size[i] = choose(1, 1, 2, 2, 3);
    star_col[i] = choose(
        make_colour_rgb(0, 240, 255),
        make_colour_rgb(255, 60, 180),
        make_colour_rgb(160, 210, 255),
        c_white
    );
}

// Ambient energy particle sparks
part_count = 25;
part_x = array_create(part_count, 0);
part_y = array_create(part_count, 0);
part_vx = array_create(part_count, 0);
part_vy = array_create(part_count, 0);
part_life = array_create(part_count, 0);
part_col = array_create(part_count, c_aqua);

for (var p = 0; p < part_count; p++) {
    part_x[p] = random(800);
    part_y[p] = random(600);
    part_vx[p] = random_range(-1.2, 1.2);
    part_vy[p] = random_range(1.5, 3.5);
    part_life[p] = random(1.0);
    part_col[p] = choose(c_aqua, c_fuchsia, c_lime);
}
`,

  gameStep: `/// obj_game: Step
var _boost = global.mcp_demo_boost + (global.mcp_overdrive > 0 ? 4 : 0);
var _warp = 1.0 + (_boost * 0.25);

// Scroll perspective cyber grid floor
grid_y = (grid_y + 2.5 * _warp) mod 40;

// Update starfield
for (var i = 0; i < star_count; i++) {
    star_y[i] += star_spd[i] * _warp;
    if (star_y[i] > 600) {
        star_y[i] = 0;
        star_x[i] = random(800);
    }
}

// Update particle embers
for (var p = 0; p < part_count; p++) {
    part_y[p] += part_vy[p] * _warp;
    part_x[p] += part_vx[p];
    part_life[p] -= 0.012;
    if (part_life[p] <= 0 || part_y[p] > 600) {
        part_x[p] = random(800);
        part_y[p] = 0;
        part_life[p] = 1.0;
    }
}

// Boost decay over time
if (global.mcp_demo_boost > 0) {
    global.mcp_demo_boost = max(0, global.mcp_demo_boost - 0.03);
}

// Continuous tactical score accumulation
global.mcp_score += round(12 * global.mcp_multiplier);
`,

  gameDraw: `/// obj_game: Draw - Space backdrop, perspective cyber grid & stars
// Deep space gradient
draw_rectangle_colour(
    0, 0, 800, 600,
    make_colour_rgb(6, 8, 24),
    make_colour_rgb(6, 8, 24),
    make_colour_rgb(12, 16, 40),
    make_colour_rgb(12, 16, 40),
    false
);

gpu_set_blendmode(bm_add);

// Perspective Cyber Grid Floor
var _grid_col = (global.mcp_overdrive > 0 || global.mcp_demo_boost > 0)
    ? make_colour_rgb(180, 40, 140)
    : make_colour_rgb(20, 80, 170);

var _horizon_y = 260;

// Converging vertical perspective lines
for (var gx = -300; gx <= 1100; gx += 80) {
    draw_set_alpha(0.25);
    draw_set_colour(_grid_col);
    draw_line_width(400 + (gx - 400) * 0.15, _horizon_y, gx, 600, 1.5);
}

// Transverse perspective lines
for (var gy = 0; gy < 10; gy++) {
    var _ratio = (gy + (grid_y / 40)) / 10;
    var _line_y = _horizon_y + (_ratio * _ratio) * (600 - _horizon_y);
    var _alpha = 0.08 + (_ratio * 0.35);
    draw_set_alpha(_alpha);
    draw_set_colour(_grid_col);
    draw_line_width(0, _line_y, 800, _line_y, 1.5);
}

// Horizon neon glow beam
draw_set_alpha(0.6);
draw_set_colour(make_colour_rgb(0, 210, 255));
draw_line_width(0, _horizon_y, 800, _horizon_y, 2);
draw_set_alpha(0.2);
draw_line_width(0, _horizon_y, 800, _horizon_y, 6);

// Starfield
for (var i = 0; i < star_count; i++) {
    draw_set_alpha(0.85);
    draw_set_colour(star_col[i]);
    if (star_spd[i] > 3) {
        var _len = star_spd[i] * (2.5 + global.mcp_demo_boost * 0.5);
        draw_line_width(star_x[i], star_y[i] - _len, star_x[i], star_y[i], 1.5);
    } else {
        draw_circle(star_x[i], star_y[i], star_size[i], false);
    }
}

// Floating ambient sparks
for (var p = 0; p < part_count; p++) {
    draw_set_alpha(part_life[p] * 0.8);
    draw_set_colour(part_col[p]);
    draw_circle(part_x[p], part_y[p], 2, false);
}

gpu_set_blendmode(bm_normal);
draw_set_alpha(1.0);
`,

  gameDrawGui: `/// obj_game: Draw GUI - Cyberpunk HUD & Live MCP Telemetry
draw_set_font(-1);

// 1. Top Header Bar
draw_set_alpha(0.88);
draw_set_colour(make_colour_rgb(8, 12, 26));
draw_rectangle(0, 0, 800, 46, false);

draw_set_alpha(1.0);
draw_set_colour(make_colour_rgb(0, 240, 255));
draw_line_width(0, 46, 800, 46, 2);

// Center Title with arcade drop shadow
draw_set_halign(fa_center);
draw_set_valign(fa_middle);
draw_set_colour(c_black);
draw_text_transformed(401, 24, "CYBER SURGE // MCP ARENA", 1.4, 1.4, 0);
draw_set_colour(make_colour_rgb(0, 255, 255));
draw_text_transformed(400, 23, "CYBER SURGE // MCP ARENA", 1.4, 1.4, 0);

// Left Bridge Indicator (Pulsing Green LED)
draw_set_halign(fa_left);
var _led_glow = 0.7 + sin(current_time * 0.008) * 0.3;
draw_set_alpha(_led_glow);
draw_set_colour(make_colour_rgb(50, 255, 120));
draw_circle(24, 23, 5, false);

draw_set_alpha(1.0);
draw_set_colour(make_colour_rgb(180, 255, 200));
draw_text(36, 23, "[AI BRIDGE: ONLINE]");

// Right Target Environment Indicator
draw_set_halign(fa_right);
draw_set_colour(make_colour_rgb(180, 210, 255));
draw_text(776, 23, "[PORT: 18253] [LTS 2026]");

// 2. Left HUD Panel - Mission Telemetry
draw_set_halign(fa_left);
draw_set_valign(fa_top);

draw_set_alpha(0.82);
draw_set_colour(make_colour_rgb(8, 12, 24));
draw_roundrect(16, 58, 275, 195, false);

draw_set_alpha(1.0);
draw_set_colour(make_colour_rgb(0, 210, 255));
draw_roundrect(16, 58, 275, 195, true);

// Header banner in card
draw_set_colour(make_colour_rgb(10, 50, 100));
draw_roundrect(16, 58, 275, 82, false);
draw_set_colour(make_colour_rgb(0, 255, 255));
draw_text(26, 64, "MISSION TELEMETRY");

// Score & Multiplier
draw_set_colour(c_white);
draw_text(26, 92, "SCORE:      " + string(global.mcp_score));
draw_set_colour(make_colour_rgb(255, 220, 80));
draw_text(26, 114, "COMBO:      x" + string(global.mcp_multiplier) + " MULTIPLIER");

// Overdrive Bar
draw_set_colour(c_white);
draw_text(26, 138, "OVERDRIVE:");
draw_set_colour(make_colour_rgb(30, 30, 45));
draw_rectangle(125, 140, 260, 152, false);

var _ov_w = (global.mcp_overdrive > 0) ? 1.0 : (min(global.mcp_demo_boost / 10, 1.0));
var _ov_col = (global.mcp_overdrive > 0 || global.mcp_demo_boost > 0)
    ? make_colour_rgb(255, 60, 160)
    : make_colour_rgb(0, 200, 255);
draw_set_colour(_ov_col);
draw_rectangle(125, 140, 125 + (135 * _ov_w), 152, false);
draw_set_colour(c_white);
draw_rectangle(125, 140, 260, 152, true);

// Shields Bar
draw_set_colour(c_white);
draw_text(26, 164, "SHIELDS:   ");
draw_set_colour(make_colour_rgb(30, 30, 45));
draw_rectangle(125, 166, 260, 178, false);
draw_set_colour(make_colour_rgb(0, 255, 160));
draw_rectangle(125, 166, 260, 178, false);
draw_set_colour(c_white);
draw_rectangle(125, 166, 260, 178, true);

// 3. Right HUD Panel - MCP Bridge Controls
draw_set_alpha(0.82);
draw_set_colour(make_colour_rgb(8, 12, 24));
draw_roundrect(525, 58, 784, 195, false);

draw_set_alpha(1.0);
draw_set_colour(make_colour_rgb(255, 60, 180));
draw_roundrect(525, 58, 784, 195, true);

// Header banner in right card
draw_set_colour(make_colour_rgb(90, 15, 65));
draw_roundrect(525, 58, 784, 82, false);
draw_set_colour(make_colour_rgb(255, 120, 220));
draw_text(538, 64, "AI BRIDGE TELEMETRY");

// Speed
var _cur_spd = global.mcp_demo_speed + global.mcp_demo_boost;
var _spd_txt = "SPEED:      " + string(_cur_spd);
if (global.mcp_demo_boost > 0 || global.mcp_overdrive > 0) _spd_txt += " [BOOSTED]";
draw_set_colour((global.mcp_demo_boost > 0 || global.mcp_overdrive > 0) ? make_colour_rgb(255, 230, 60) : c_white);
draw_text(538, 92, _spd_txt);

// Entities
draw_set_colour(c_white);
draw_text(538, 114, "ENTITIES:   " + string(instance_count) + " ACTIVE");

// Room
draw_set_colour(c_white);
draw_text(538, 138, "ROOM:       rm_demo (800x600)");

// FPS
draw_set_colour(make_colour_rgb(0, 255, 180));
draw_text(538, 164, "FPS:        " + string(fps) + " / 60 (STABLE)");

// 4. Prominent Center Overdrive Banner (if boosted)
if (global.mcp_demo_boost > 0 || global.mcp_overdrive > 0) {
    draw_set_alpha(0.9);
    draw_set_colour(make_colour_rgb(45, 10, 32));
    draw_roundrect(170, 210, 630, 252, false);

    draw_set_alpha(1.0);
    draw_set_colour(make_colour_rgb(255, 60, 160));
    draw_roundrect(170, 210, 630, 252, true);

    draw_set_halign(fa_center);
    draw_set_valign(fa_middle);
    draw_set_colour(make_colour_rgb(255, 240, 60));
    draw_text_transformed(400, 231, "⚡ MCP OVERDRIVE ENGAGED: SPEED BOOST + FIRE SURGE ⚡", 1.05, 1.05, 0);
}

// 5. Bottom Command Status Strip
draw_set_alpha(0.78);
draw_set_colour(make_colour_rgb(6, 10, 22));
draw_roundrect(16, 560, 784, 590, false);

draw_set_alpha(1.0);
draw_set_colour(make_colour_rgb(0, 160, 220));
draw_roundrect(16, 560, 784, 590, true);

draw_set_halign(fa_center);
draw_set_valign(fa_middle);
draw_set_colour(make_colour_rgb(180, 230, 255));
draw_text(400, 575, "AI COMMANDS: gm_bridge_call(\\"demo_boost\\") | gm_bridge_set_globals | KEY: SPACE");
`,

  playerCreate: `/// obj_player: Create
x = 400;
y = 480;
tilt = 0;
shield_rot = 0;
laser_timer = 0;

// Engine exhaust trail buffer
trail_len = 10;
trail_x = array_create(trail_len, x);
trail_y = array_create(trail_len, y);
`,

  playerStep: `/// obj_player: Step
shield_rot = (shield_rot + 5) mod 360;

var _spd = global.mcp_demo_speed + global.mcp_demo_boost;
if (global.mcp_overdrive > 0) _spd += 3;

// Sweep patrol pattern
var _sweep = sin(current_time * 0.0022) * 190;
x = 400 + _sweep;
tilt = lerp(tilt, cos(current_time * 0.0022) * 18, 0.2);

x = clamp(x, 100, 700);

// Update thruster trail
for (var i = trail_len - 1; i > 0; i--) {
    trail_x[i] = trail_x[i - 1];
    trail_y[i] = trail_y[i - 1];
}
trail_x[0] = x;
trail_y[0] = y + 16;

// Auto-fire dual plasma bolts
laser_timer += 1;
var _fire_interval = (global.mcp_demo_boost > 0 || global.mcp_overdrive > 0) ? 6 : 14;
if (laser_timer >= _fire_interval) {
    laser_timer = 0;
    instance_create_depth(x - 14, y - 8, -5, obj_laser);
    instance_create_depth(x + 14, y - 8, -5, obj_laser);
}
`,

  playerDraw: `/// obj_player: Draw - Vector Fighter, Thrusters & Rotating Shield
gpu_set_blendmode(bm_add);

// Exhaust Trail
for (var t = 1; t < trail_len; t++) {
    var _alpha = (1.0 - (t / trail_len)) * 0.6;
    var _r = 9 * (1.0 - (t / trail_len));
    draw_set_alpha(_alpha);
    draw_set_colour(choose(c_aqua, c_fuchsia, c_white));
    draw_circle(trail_x[t] - 8, trail_y[t] + (t * 2), _r, false);
    draw_circle(trail_x[t] + 8, trail_y[t] + (t * 2), _r, false);
}

// Active Thruster Flame
var _flame_len = 16 + random(10) + (global.mcp_demo_boost * 2.5);
draw_set_alpha(0.85);
draw_set_colour(c_aqua);
draw_triangle(x - 11, y + 16, x - 5, y + 16, x - 8, y + 16 + _flame_len, false);
draw_triangle(x + 5, y + 16, x + 11, y + 16, x + 8, y + 16 + _flame_len, false);

draw_set_colour(c_white);
draw_triangle(x - 10, y + 16, x - 6, y + 16, x - 8, y + 16 + (_flame_len * 0.5), false);
draw_triangle(x + 6, y + 16, x + 10, y + 16, x + 8, y + 16 + (_flame_len * 0.5), false);

// Rotating Shield Ring
var _shield_r = 34;
var _shield_col = (global.mcp_overdrive > 0 || global.mcp_demo_boost > 0)
    ? make_colour_rgb(255, 60, 180)
    : make_colour_rgb(0, 220, 255);
draw_set_colour(_shield_col);
draw_set_alpha(0.35 + sin(current_time * 0.006) * 0.15);
draw_circle(x, y, _shield_r, true);
draw_circle(x, y, _shield_r - 1, true);

// Shield node pips
for (var n = 0; n < 4; n++) {
    var _ang = degtorad(shield_rot + (n * 90));
    var _nx = x + cos(_ang) * _shield_r;
    var _ny = y + sin(_ang) * _shield_r;
    draw_set_alpha(0.9);
    draw_set_colour(c_white);
    draw_circle(_nx, _ny, 3, false);
}

// Ship Fuselage
gpu_set_blendmode(bm_normal);
draw_set_alpha(1.0);

// Armor Hull
draw_set_colour(make_colour_rgb(14, 20, 38));
draw_triangle(x, y - 26, x - 22, y + 16, x + 22, y + 16, false);
draw_triangle(x - 28, y + 12, x - 8, y + 6, x - 22, y + 20, false);
draw_triangle(x + 28, y + 12, x + 8, y + 6, x + 22, y + 20, false);

// Neon Hull Accent Lines
draw_set_colour(make_colour_rgb(0, 240, 255));
draw_line_width(x, y - 26, x - 22, y + 16, 2);
draw_line_width(x, y - 26, x + 22, y + 16, 2);
draw_line_width(x - 22, y + 16, x + 22, y + 16, 2);

draw_set_colour(make_colour_rgb(255, 40, 160));
draw_line_width(x - 8, y + 6, x - 28, y + 12, 2);
draw_line_width(x + 8, y + 6, x + 28, y + 12, 2);

// Cockpit Canopy (Glowing Diamond)
draw_set_colour(make_colour_rgb(180, 255, 255));
draw_triangle(x, y - 14, x - 5, y - 2, x + 5, y - 2, false);
draw_triangle(x, y + 4, x - 5, y - 2, x + 5, y - 2, false);

draw_set_alpha(1.0);
`,

  playerKeypress: `/// Space key triggers boost & score
demo_boost(4);
`,

  laserCreate: `/// obj_laser: Create
vspeed = -14;
length = 26;
col = choose(make_colour_rgb(0, 255, 255), make_colour_rgb(120, 230, 255));
`,

  laserStep: `/// obj_laser: Step
if (y < -40) {
    instance_destroy();
}
// Laser collision check against nearest drone
var _nearest = instance_nearest(x, y, obj_drone);
if (_nearest != noone && point_distance(x, y, _nearest.x, _nearest.y) < 26) {
    global.mcp_score += 250;
    with (_nearest) {
        health_pct = max(0.15, health_pct - 0.2);
    }
    instance_destroy();
}
`,

  laserDraw: `/// obj_laser: Draw - Glowing dual plasma beam
gpu_set_blendmode(bm_add);
draw_set_alpha(0.45);
draw_set_colour(col);
draw_line_width(x, y, x, y + length, 6);

draw_set_alpha(0.95);
draw_set_colour(c_white);
draw_line_width(x, y, x, y + length, 2);

gpu_set_blendmode(bm_normal);
draw_set_alpha(1.0);
`,

  droneCreate: `/// obj_drone: Create
base_x = x;
base_y = y;
phase = random(100);
rot = random(360);
health_pct = 0.85;
`,

  droneStep: `/// obj_drone: Step
rot = (rot + 2) mod 360;
x = base_x + sin((current_time * 0.003) + phase) * 45;
y = base_y + cos((current_time * 0.002) + phase) * 16;
`,

  droneDraw: `/// obj_drone: Draw - Cyber Interceptor Drone
gpu_set_blendmode(bm_add);
draw_set_alpha(0.25);
draw_set_colour(make_colour_rgb(255, 30, 80));
draw_circle(x, y, 26, false);

gpu_set_blendmode(bm_normal);
draw_set_alpha(1.0);

// Drone Chassis
var _r = 18;
draw_set_colour(make_colour_rgb(28, 12, 24));
draw_triangle(x, y - _r, x - _r, y, x + _r, y, false);
draw_triangle(x, y + _r, x - _r, y, x + _r, y, false);

// Crimson Rim
draw_set_colour(make_colour_rgb(255, 40, 70));
draw_line_width(x, y - _r, x + _r, y, 2);
draw_line_width(x + _r, y, x, y + _r, 2);
draw_line_width(x, y + _r, x - _r, y, 2);
draw_line_width(x - _r, y, x, y - _r, 2);

// Pulsing Ocular Core
var _pulse = 4 + sin((current_time * 0.008) + phase) * 2;
gpu_set_blendmode(bm_add);
draw_set_colour(make_colour_rgb(255, 210, 60));
draw_circle(x, y, _pulse, false);

// Drone Health Bar
gpu_set_blendmode(bm_normal);
draw_set_alpha(0.8);
draw_set_colour(c_dkgray);
draw_rectangle(x - 16, y - 26, x + 16, y - 22, false);
draw_set_colour(make_colour_rgb(255, 50, 80));
draw_rectangle(x - 16, y - 26, x - 16 + (32 * health_pct), y - 22, false);
draw_set_colour(c_white);
draw_rectangle(x - 16, y - 26, x + 16, y - 22, true);

draw_set_alpha(1.0);
`,

  crystalCreate: `/// obj_crystal: Create
base_y = y;
rot = random(360);
phase = random(100);
`,

  crystalStep: `/// obj_crystal: Step
rot = (rot + 3) mod 360;
y = base_y + sin((current_time * 0.004) + phase) * 12;
`,

  crystalDraw: `/// obj_crystal: Draw - Spinning Faceted Energy Core
gpu_set_blendmode(bm_add);
draw_set_alpha(0.35 + sin((current_time * 0.006) + phase) * 0.15);
draw_set_colour(make_colour_rgb(0, 255, 140));
draw_circle(x, y, 22, false);

var _rad = 14;
var _rad_w = max(2, 9 * abs(dcos(rot)));
draw_set_alpha(0.9);
draw_set_colour(make_colour_rgb(180, 255, 210));
draw_triangle(x, y - _rad, x - _rad_w, y, x + _rad_w, y, false);
draw_set_colour(make_colour_rgb(0, 220, 120));
draw_triangle(x, y + _rad, x - _rad_w, y, x + _rad_w, y, false);

draw_set_colour(c_white);
draw_line(x, y - _rad, x + _rad_w, y);
draw_line(x + _rad_w, y, x, y + _rad);
draw_line(x, y + _rad, x - _rad_w, y);
draw_line(x - _rad_w, y, x, y - _rad);

gpu_set_blendmode(bm_normal);
draw_set_alpha(1.0);
`,
};

/* ---------------- 4. Execute the live demo ---------------- */
log("================================================================");
log("  gamemaker-mcp LIVE DEMO: CYBER SURGE // MCP ARENA");
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

await step("gm_create_object obj_game, obj_player, obj_laser, obj_drone, obj_crystal", async () => {
  await tool("gm_create_object", { name: "obj_game" });
  await tool("gm_create_object", { name: "obj_player" });
  await tool("gm_create_object", { name: "obj_laser" });
  await tool("gm_create_object", { name: "obj_drone" });
  await tool("gm_create_object", { name: "obj_crystal" });
});

await step("gm_set_object_event for all game entities", async () => {
  const events = [
    // obj_game
    ["obj_game", "Create", GML.gameCreate],
    ["obj_game", "Step", GML.gameStep],
    ["obj_game", "Draw", GML.gameDraw],
    ["obj_game", "Draw GUI", GML.gameDrawGui],
    // obj_player
    ["obj_player", "Create", GML.playerCreate],
    ["obj_player", "Step", GML.playerStep],
    ["obj_player", "Draw", GML.playerDraw],
    ["obj_player", "KeyPress:32", GML.playerKeypress],
    // obj_laser
    ["obj_laser", "Create", GML.laserCreate],
    ["obj_laser", "Step", GML.laserStep],
    ["obj_laser", "Draw", GML.laserDraw],
    // obj_drone
    ["obj_drone", "Create", GML.droneCreate],
    ["obj_drone", "Step", GML.droneStep],
    ["obj_drone", "Draw", GML.droneDraw],
    // obj_crystal
    ["obj_crystal", "Create", GML.crystalCreate],
    ["obj_crystal", "Step", GML.crystalStep],
    ["obj_crystal", "Draw", GML.crystalDraw],
  ];

  for (const [object, event, code] of events) {
    await tool("gm_set_object_event", { object, event, code });
  }
  log(`   configured 17 events across 5 objects`);
});

await step('gm_search_gml "mcp_demo_speed"', async () => {
  const r = toolJson(await tool("gm_search_gml", { pattern: "mcp_demo_speed" }));
  log(`   ${r.matches} matches in ${[...new Set(r.hits.map((h) => h.resource))].join(", ")}`);
});

await step("gm_read_gml obj_player Step (excerpt)", async () => {
  const r = await tool("gm_read_gml", { name: "obj_player", event: "Step" });
  log(`   ${r.content[0].text.split("\n").slice(0, 3).join(" / ")} ...`);
});

await step("gm_add_instance entities into rm_demo", async () => {
  // Game controller
  await tool("gm_add_instance", { room: "rm_demo", object: "obj_game", x: 0, y: 0 });
  // Player interceptor
  await tool("gm_add_instance", { room: "rm_demo", object: "obj_player", x: 400, y: 480 });
  // Enemy drones
  await tool("gm_add_instance", { room: "rm_demo", object: "obj_drone", x: 180, y: 160 });
  await tool("gm_add_instance", { room: "rm_demo", object: "obj_drone", x: 340, y: 135 });
  await tool("gm_add_instance", { room: "rm_demo", object: "obj_drone", x: 460, y: 135 });
  await tool("gm_add_instance", { room: "rm_demo", object: "obj_drone", x: 620, y: 160 });
  // Energy crystals
  await tool("gm_add_instance", { room: "rm_demo", object: "obj_crystal", x: 220, y: 290 });
  await tool("gm_add_instance", { room: "rm_demo", object: "obj_crystal", x: 400, y: 260 });
  await tool("gm_add_instance", { room: "rm_demo", object: "obj_crystal", x: 580, y: 290 });
  log(`   placed controller, player, 4 drones, 3 crystals`);
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

// Let the initial frame render and lasers begin cycle
await sleep(1000);

const shot1 = await step("gm_bridge_screenshot (baseline)", () => screenshot("shot1_start.png"));

await step("gm_bridge_get_globals", async () => {
  const r = toolJson(await tool("gm_bridge_get_globals", { names: ["mcp_score", "mcp_demo_speed"] }));
  log(`   ${JSON.stringify(r.values)}`);
});

await step("gm_bridge_set_globals speed -> 9", async () => {
  await tool("gm_bridge_set_globals", { values: { mcp_demo_speed: 9 } });
  const r = toolJson(await tool("gm_bridge_get_globals", { names: ["mcp_demo_speed"] }));
  log(`   live speed is now ${r.values.mcp_demo_speed}`);
});

await step("gm_bridge_call demo_overdrive(true) & demo_boost(8)", async () => {
  await tool("gm_bridge_call", { function: "demo_overdrive", args: [true] });
  await tool("gm_bridge_call", { function: "demo_boost", args: [8] });
  const r = toolJson(await tool("gm_bridge_get_globals", { names: ["mcp_overdrive", "mcp_demo_boost"] }));
  log(`   overdrive=${r.values.mcp_overdrive} boost=${r.values.mcp_demo_boost}`);
});

const playerId = await step("gm_bridge_list_instances obj_player (live position)", async () => {
  const r = toolJson(
    await tool("gm_bridge_list_instances", { object: "obj_player", fields: ["x", "y", "tilt"] }),
  );
  const p = r.instances[0];
  log(`   id=${p.id} x=${Math.round(p.x)} y=${Math.round(p.y)} tilt=${Math.round(p.tilt)}`);
  return p?.id;
});

const shot2 = await step("gm_bridge_screenshot (after live overdrive changes)", async () => {
  await sleep(1500); // let overdrive particles and high-speed stars surge
  return screenshot("shot2_boosted.png");
});

await step("gm_bridge_set_instance (teleport player to 400, 470)", async () => {
  if (!playerId) throw new Error("no player id");
  await tool("gm_bridge_set_instance", { id: playerId, values: { x: 400, y: 470 } });
  log(`   player instance ${playerId} repositioned`);
});

await step("gm_bridge_key space (simulated spacebar volley)", async () => {
  await tool("gm_bridge_key", { key: "space", action: "press" });
  await tool("gm_bridge_key", { key: "space", action: "release" });
  log("   simulated spacebar press & release");
});

const shot3 = await step("gm_bridge_screenshot (after simulated key & full plasma barrage)", async () => {
  await sleep(1200);
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

// Copy generated screenshots to docs/images
if (shot1 && shot2 && shot3) {
  fs.mkdirSync(DOCS_IMG_DIR, { recursive: true });
  fs.copyFileSync(shot1.file, path.join(DOCS_IMG_DIR, "demo-1-start.png"));
  fs.copyFileSync(shot2.file, path.join(DOCS_IMG_DIR, "demo-2-live-changed.png"));
  fs.copyFileSync(shot3.file, path.join(DOCS_IMG_DIR, "demo-3-after-boost.png"));
  log(`\n📋 updated docs/images/demo-{1,2,3}*.png`);
}

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
