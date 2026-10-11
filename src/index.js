#!/usr/bin/env node
// gamemaker-mcp - MCP server for GameMaker (LTS 2026 / 2024.x on macOS).
//
// Lets an AI model work directly on GameMaker projects:
//  - inspect and edit projects on disk (.yyp/.yy/.gml): scripts, objects with
//    events, rooms with instances and creation code, sprites from PNGs
//  - build and launch games through the Igor CLI (release builds)
//  - talk to a running game through the injected MCP bridge (live variables,
//    instances, rooms, screenshots, key injection)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getSettings, recentProjects } from "./config.js";
import { GMProject } from "./project.js";
import { readYY } from "./yy.js";
import * as C from "./creators.js";
import { resolveEvent, eventName } from "./events.js";
import {
  igorArgs,
  runIgor,
  parseIgorOutput,
  outputDir,
  macInstallDir,
  stageMacGame,
  launchMacApp,
  runningGames,
  killGames,
} from "./igor.js";
import { connectToGame } from "./bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GML_DIR = path.join(__dirname, "..", "gml");

/* Session state - shared across tool calls (this is a single-user local tool). */
/** @type {GMProject | null} */
let project = null;
/** @type {import("./bridge.js").BridgeClient | null} */
let bridge = null;
let lastBuild = null;
let lastRun = null;
let saveArea = null;

/** Build a configured MCP server (one instance per client connection). */
function createServer() {
  const server = new McpServer({ name: "gamemaker-mcp", version: "0.1.0" });

const ok = (v) => ({
  content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }],
});
const bad = (msg) => ({ content: [{ type: "text", text: String(msg) }], isError: true });
const wrap = (fn) => async (a) => {
  try {
    return await fn(a);
  } catch (e) {
    return bad(e?.message ?? String(e));
  }
};
const needProject = () => {
  if (!project) throw new Error("No project open. Call gm_open_project first.");
  return project;
};
const needBridge = () => {
  if (!bridge || !bridge.connected) {
    throw new Error("Not connected to a running game. Start it with gm_run_game first.");
  }
  return bridge;
};

/* ------------------------------------------------------------------ */
/* Environment / projects                                              */
/* ------------------------------------------------------------------ */

server.registerTool(
  "gm_runtime_info",
  {
    title: "GameMaker environment info",
    description:
      "Report the detected GameMaker installation: Igor CLI path, runtime folders, user folder (licence), recent projects, bridge port.",
    inputSchema: {},
  },
  wrap(async () => {
    const s = getSettings();
    return ok({
      igorPath: s.igorPath ?? "(not found)",
      runtimePath: s.runtimePath ?? "(not found)",
      userFolder: s.userFolder ?? "(not found)",
      licenceFile: s.licenceFile ?? "(not found)",
      projectsDir: s.projectsDir ?? "(not found)",
      bridgePort: s.bridgePort,
      ideInstalls: s.ideInstalls.map((i) => i.path),
      runtimes: s.runtimes.map((r) => ({ version: r.version, path: r.dir, hasIgor: !!r.igor })),
      recentProjects: recentProjects().slice(0, 15),
    });
  }),
);

server.registerTool(
  "gm_list_projects",
  {
    title: "List GameMaker projects",
    description:
      "List known GameMaker projects: the IDE recent-projects list plus .yyp files found under a directory (default: the detected projects folder).",
    inputSchema: {
      searchDir: z.string().optional().describe("Directory to scan (recursively, up to 4 levels)."),
    },
  },
  wrap(async ({ searchDir }) => {
    const s = getSettings();
    const found = new Set(recentProjects());
    const root = searchDir ?? s.projectsDir;
    if (root && fs.existsSync(root)) {
      const walk = (dir, depth) => {
        if (depth > 4) return;
        let entries = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (e.name.startsWith(".") || e.name === "node_modules") continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full, depth + 1);
          else if (e.name.endsWith(".yyp")) found.add(full);
        }
      };
      walk(root, 0);
    }
    return ok([...found]);
  }),
);

server.registerTool(
  "gm_open_project",
  {
    title: "Open a GameMaker project",
    description:
      "Open a .yyp project file (or a folder containing one) and make it the active project for all other tools.",
    inputSchema: {
      path: z.string().describe("Absolute path to the .yyp file or to the project folder."),
    },
  },
  wrap(async ({ path: p }) => {
    let yyp = p;
    if (fs.existsSync(yyp) && fs.statSync(yyp).isDirectory()) {
      const candidates = fs.readdirSync(yyp).filter((f) => f.endsWith(".yyp"));
      if (candidates.length === 0) throw new Error(`No .yyp file inside ${p}`);
      yyp = path.join(yyp, candidates[0]);
    }
    if (fs.existsSync(yyp) && fs.statSync(yyp).isDirectory()) {
      const inner = fs.readdirSync(yyp).filter((f) => f.endsWith(".yyp"));
      if (inner.length === 0) throw new Error(`No .yyp file inside ${yyp}`);
      yyp = path.join(yyp, inner[0]);
    }
    project = new GMProject(yyp);
    return ok(project.summary());
  }),
);

server.registerTool(
  "gm_create_project",
  {
    title: "Create a new GameMaker project",
    description:
      "Bootstrap a new, valid GameMaker project (.yyp) with standard folders and a default starting room, and make it the active project.",
    inputSchema: {
      name: z.string().describe("Project name (e.g. SpaceShooter)."),
      dir: z
        .string()
        .optional()
        .describe("Target folder where the project directory will be created (defaults to detected projects folder)."),
      firstRoom: z.string().optional().describe('Name of initial room, default "rm_game".'),
      width: z.number().int().positive().optional().describe("Room width (default 1366)."),
      height: z.number().int().positive().optional().describe("Room height (default 768)."),
    },
  },
  wrap(async ({ name, dir, firstRoom, width, height }) => {
    const s = getSettings();
    const baseDir = dir ?? s.projectsDir ?? path.join(os.homedir(), "GameMakerProjects");
    const projDir = path.join(baseDir, name);
    const created = C.createProject(projDir, name, { firstRoom, width, height });
    project = created.project;
    return ok({
      created: true,
      name: created.name,
      yypPath: created.yypPath,
      summary: project.summary(),
    });
  }),
);

server.registerTool(
  "gm_close_project",
  {
    title: "Close active project",
    description: "Close the currently active project and clear active project state.",
    inputSchema: {},
  },
  wrap(async () => {
    const prev = project?.name;
    project = null;
    return ok({ closed: true, previousProject: prev ?? null });
  }),
);

server.registerTool(
  "gm_project_summary",
  {
    title: "Active project summary",
    description: "Overview of the active project: resource counts, room order, IDE version.",
    inputSchema: {},
  },
  wrap(async () => ok(needProject().summary())),
);

server.registerTool(
  "gm_list_resources",
  {
    title: "List project resources",
    description:
      "List resources in the active project, optionally filtered by type (script, object, room, sprite, sound, ...).",
    inputSchema: {
      type: z.string().optional().describe("Resource type filter, e.g. script/object/room/sprite."),
    },
  },
  wrap(async ({ type }) => ok(needProject().listResources(type))),
);

server.registerTool(
  "gm_read_resource",
  {
    title: "Read a resource .yy file",
    description: "Return the raw JSON of a resource's .yy file (e.g. an object or room definition).",
    inputSchema: { name: z.string().describe("Resource name.") },
  },
  wrap(async ({ name }) => {
    const p = needProject();
    const file = p.resourceYY(name);
    return ok({ file, yy: readYY(file) });
  }),
);

server.registerTool(
  "gm_search_gml",
  {
    title: "Search GML code",
    description: "Regex-search all .gml files of the project and return matching lines with file and line numbers.",
    inputSchema: {
      pattern: z.string().describe("JavaScript regular expression."),
      type: z.string().optional().describe("Limit to a resource type, e.g. 'script' or 'object'."),
      limit: z.number().int().positive().max(500).optional(),
    },
  },
  wrap(async ({ pattern, type, limit = 100 }) => {
    const p = needProject();
    const re = new RegExp(pattern);
    const hits = [];
    for (const r of p.listResources(type)) {
      const dir = p.resourceDir(r.name);
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".gml")) continue;
        const lines = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/);
        lines.forEach((line, i) => {
          if (hits.length < limit && re.test(line)) {
            hits.push({ resource: r.name, file: f, line: i + 1, text: line.trim() });
          }
        });
      }
    }
    return ok({ matches: hits.length, hits });
  }),
);

server.registerTool(
  "gm_read_gml",
  {
    title: "Read GML code",
    description: "Read the GML source of a script, or of one object event (pass an event name for objects).",
    inputSchema: {
      name: z.string().describe("Script or object resource name."),
      event: z
        .string()
        .optional()
        .describe('Event name, e.g. "Create", "Step", "Draw GUI", "Async - Networking", "Alarm 3".'),
    },
  },
  wrap(async ({ name, event }) => {
    const p = needProject();
    const r = p.findResource(name);
    if (!r) throw new Error(`Resource "${name}" not found.`);
    if (event) return ok(C.readObjectEvent(p, name, event));
    if (r.type === "GMScript") return ok(C.readScript(p, name));
    throw new Error(`"${name}" is not a script - pass an event name to read an object event.`);
  }),
);

server.registerTool(
  "gm_write_gml",
  {
    title: "Write GML code",
    description:
      "Overwrite the full GML source of a script, or of one object event. Creates the event if it does not exist yet.",
    inputSchema: {
      name: z.string().describe("Script or object resource name."),
      content: z.string().describe("Full GML source."),
      event: z.string().optional().describe("Object event name (see gm_read_gml)."),
    },
  },
  wrap(async ({ name, event, content }) => {
    const p = needProject();
    if (event) {
      const ev = C.setObjectEvent(p, name, event, content);
      return ok({ written: ev.fileName, canonicalName: ev.canonicalName });
    }
    C.updateScript(p, name, content);
    return ok({ written: `scripts/${name}/${name}.gml` });
  }),
);

server.registerTool(
  "gm_create_script",
  {
    title: "Create a script",
    description: "Create a new GML script resource (scripts/<name>/<name>.gml + .yy) and register it in the project.",
    inputSchema: {
      name: z.string().describe("Script name (valid GML identifier, e.g. scr_helpers)."),
      content: z.string().optional().describe("Initial GML source."),
    },
  },
  wrap(async ({ name, content }) => ok({ script: name, path: C.createScript(needProject(), name, content ?? "") })),
);

server.registerTool(
  "gm_delete_resource",
  {
    title: "Delete a resource",
    description: "Delete a resource folder and remove it from the project file. Use with care.",
    inputSchema: { name: z.string() },
  },
  wrap(async ({ name }) => {
    const p = needProject();
    p.deleteResource(name);
    p.save();
    return ok({ deleted: name });
  }),
);

server.registerTool(
  "gm_create_object",
  {
    title: "Create an object",
    description: "Create a new object resource (no events yet - use gm_write_gml to add events).",
    inputSchema: {
      name: z.string(),
      parentObject: z.string().optional().describe("Parent object name."),
      sprite: z.string().optional().describe("Sprite name to assign."),
      persistent: z.boolean().optional(),
      visible: z.boolean().optional(),
    },
  },
  wrap(async (a) => ok({ object: a.name, path: C.createObject(needProject(), a.name, a) })),
);

server.registerTool(
  "gm_get_object",
  {
    title: "Get object properties and events",
    description:
      "Inspect an object's properties: assigned sprite, parent object, visible, solid, persistent flags, and its list of events.",
    inputSchema: { object: z.string().describe("Object name.") },
  },
  wrap(async ({ object }) => ok(C.getObject(needProject(), object))),
);

server.registerTool(
  "gm_set_object_properties",
  {
    title: "Update object properties",
    description:
      "Update an existing object's properties: sprite, parentObject, visible, solid, persistent.",
    inputSchema: {
      object: z.string().describe("Object name."),
      sprite: z.string().nullable().optional().describe("Sprite name to assign, or null to remove."),
      parentObject: z.string().nullable().optional().describe("Parent object name, or null to remove."),
      visible: z.boolean().optional(),
      solid: z.boolean().optional(),
      persistent: z.boolean().optional(),
    },
  },
  wrap(async ({ object, sprite, parentObject, visible, solid, persistent }) =>
    ok(C.updateObject(needProject(), object, { sprite, parentObject, visible, solid, persistent })),
  ),
);

server.registerTool(
  "gm_list_object_events",
  {
    title: "List an object's events",
    description: "List all events of an object with their file names and whether they contain code.",
    inputSchema: { object: z.string() },
  },
  wrap(async ({ object }) => ok(C.listObjectEvents(needProject(), object))),
);

server.registerTool(
  "gm_set_object_event",
  {
    title: "Set an object event",
    description:
      'Create/overwrite code for an object event. Names like "Create", "Step", "End Step", "Draw", "Draw GUI", "Room Start", "Alarm 0", "User 3", "Async - Networking", "Other:68".',
    inputSchema: { object: z.string(), event: z.string(), code: z.string() },
  },
  wrap(async ({ object, event, code }) => {
    const ev = C.setObjectEvent(needProject(), object, event, code);
    return ok({ object, event: ev.canonicalName, file: ev.fileName });
  }),
);

server.registerTool(
  "gm_remove_object_event",
  {
    title: "Remove an object event",
    description: "Remove an event (and its .gml file) from an object.",
    inputSchema: { object: z.string(), event: z.string() },
  },
  wrap(async ({ object, event }) => ok(C.removeObjectEvent(needProject(), object, event))),
);

server.registerTool(
  "gm_create_room",
  {
    title: "Create a room",
    description: "Create a room with standard Instances + Background layers and add it to the room order.",
    inputSchema: {
      name: z.string(),
      width: z.number().int().positive().optional().describe("Default 1366."),
      height: z.number().int().positive().optional().describe("Default 768."),
      first: z.boolean().optional().describe("Make it the first room (game start) if true."),
      persistent: z.boolean().optional(),
    },
  },
  wrap(async (a) => ok({ room: a.name, path: C.createRoom(needProject(), a.name, a) })),
);

server.registerTool(
  "gm_list_room_instances",
  {
    title: "List room instances",
    description: "List every instance placed in a room with object, position and layer.",
    inputSchema: { room: z.string() },
  },
  wrap(async ({ room }) => ok(C.listRoomInstances(needProject(), room))),
);

server.registerTool(
  "gm_add_instance",
  {
    title: "Place an instance in a room",
    description: "Add an instance of an object to a room (optionally with instance creation code).",
    inputSchema: {
      room: z.string(),
      object: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      layer: z.string().optional().describe('Instance layer name, default "Instances".'),
      creationCode: z.string().optional().describe("Instance creation code."),
    },
  },
  wrap(async ({ room, object, x, y, layer, creationCode }) =>
    ok({
      instance: C.addRoomInstance(needProject(), room, object, x ?? 0, y ?? 0, { layer, creationCode }),
      room,
      object,
    }),
  ),
);

server.registerTool(
  "gm_remove_instance",
  {
    title: "Remove an instance from a room",
    description: "Remove an instance by its instance name (e.g. inst_AB12CD34).",
    inputSchema: { room: z.string(), instance: z.string() },
  },
  wrap(async ({ room, instance }) =>
    ok({ removed: C.removeRoomInstance(needProject(), room, instance) }),
  ),
);

server.registerTool(
  "gm_set_room_creation_code",
  {
    title: "Set room creation code",
    description: "Write (or clear with empty code) the RoomCreationCode.gml of a room.",
    inputSchema: { room: z.string(), code: z.string() },
  },
  wrap(async ({ room, code }) => ok({ creationCodeFile: C.setRoomCreationCode(needProject(), room, code) })),
);

server.registerTool(
  "gm_get_room",
  {
    title: "Get room details",
    description: "Get room dimensions, persistence, layers, instance count, instances, and creation code path.",
    inputSchema: { room: z.string().describe("Room name.") },
  },
  wrap(async ({ room }) => ok(C.getRoom(needProject(), room))),
);

server.registerTool(
  "gm_set_room_properties",
  {
    title: "Update room properties",
    description: "Update room dimensions (width, height) and persistence.",
    inputSchema: {
      room: z.string().describe("Room name."),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      persistent: z.boolean().optional(),
    },
  },
  wrap(async ({ room, width, height, persistent }) =>
    ok(C.updateRoom(needProject(), room, { width, height, persistent })),
  ),
);

server.registerTool(
  "gm_set_first_room",
  {
    title: "Set starting room",
    description:
      "Set an existing room as the first room in the project room order (the room where the game starts).",
    inputSchema: { room: z.string().describe("Room name.") },
  },
  wrap(async ({ room }) => ok({ roomOrder: C.setFirstRoom(needProject(), room) })),
);

server.registerTool(
  "gm_import_sprite",
  {
    title: "Import a sprite from PNGs",
    description:
      "Create a sprite resource from one or more PNG files (absolute paths, played in order). Writes the modern frame/layer GUID layout and a sprite sequence.",
    inputSchema: {
      name: z.string().describe("Sprite name (e.g. spr_hero)."),
      frames: z.array(z.string()).min(1).describe("Absolute PNG paths in playback order."),
      fps: z.number().positive().optional().describe("Animation speed (default 30)."),
      originX: z.number().optional().describe("Origin X (default: center)."),
      originY: z.number().optional().describe("Origin Y (default: center)."),
    },
  },
  wrap(async ({ name, frames, fps, originX, originY }) =>
    ok(C.importSprite(needProject(), name, frames, { fps, originX, originY })),
  ),
);

server.registerTool(
  "gm_inject_bridge",
  {
    title: "Inject the MCP runtime bridge",
    description:
      "Add the mcp_bridge script + obj_mcp_bridge object (persistent, invisible) to the project and place it in the first room, so a running game accepts live control over TCP. Idempotent.",
    inputSchema: {
      port: z.number().int().min(1024).max(65535).optional().describe("Bridge TCP port (default 18253)."),
    },
  },
  wrap(async ({ port }) => ok(C.injectBridge(needProject(), { gmlDir: GML_DIR, port }))),
);

/* ------------------------------------------------------------------ */
/* Build + run                                                         */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function defaultSaveArea() {
  return path.join(os.homedir(), "Library", "Application Support", "com.yoyogames.macyoyorunner");
}

function ensureRunnerInstalled(installDir, outDir) {
  const appPath = path.join(installDir, "YoYo Runner.app");
  if (fs.existsSync(appPath)) return;

  // 1) try the installer Igor generated (works when its DMG is present)
  const installer = path.join(outDir, "install_dmg.sh");
  if (fs.existsSync(installer)) {
    spawnSync("bash", [installer], { cwd: outDir, timeout: 120000 });
  }
  if (fs.existsSync(appPath)) return;

  // 2) copy the runner from any existing GameMaker install (a project that was
  //    once run from the IDE installs it), else from the runtime template.
  fs.mkdirSync(installDir, { recursive: true });
  const candidates = [];
  const gmMacRoot = path.join(os.homedir(), "GameMakerStudio2", "GM_MAC");
  if (fs.existsSync(gmMacRoot)) {
    for (const entry of fs.readdirSync(gmMacRoot)) {
      const dir = path.join(gmMacRoot, entry);
      if (fs.existsSync(path.join(dir, "YoYo Runner.app"))) candidates.push(dir);
    }
  }
  const s = getSettings();
  if (s.runtimePath) {
    const tplDir = path.join(s.runtimePath, "mac");
    if (fs.existsSync(path.join(tplDir, "YoYo Runner.app"))) candidates.push(tplDir);
  }
  const src = candidates.find((c) => path.resolve(c) !== path.resolve(installDir));
  if (!src) {
    throw new Error(
      `YoYo Runner.app is not installed and no existing install was found. ` +
        `Run the game once from the GameMaker IDE for this project, then retry.`,
    );
  }
  fs.cpSync(path.join(src, "YoYo Runner.app"), appPath, { recursive: true });
  const yoyo = path.join(installDir, ".yoyo");
  fs.mkdirSync(yoyo, { recursive: true });
  const dmgInfo = path.join(yoyo, "dmg.info");
  if (!fs.existsSync(dmgInfo)) fs.writeFileSync(dmgInfo, "copied-by-gamemaker-mcp\n");
}

async function doBuild(attempt = 1) {
  const p = needProject();
  const s = getSettings();
  if (!s.igorPath) {
    throw new Error(
      "Igor CLI not found. Check gm_runtime_info, or set GAMEMAKER_IGOR / GAMEMAKER_RUNTIME, or create ~/.gamemaker-mcp.json.",
    );
  }
  if (!s.runtimePath) throw new Error("No GameMaker runtime folder found.");
  const workDir = path.join(os.homedir(), ".gamemaker-mcp", "build", p.name.replace(/[^\w.-]+/g, "_"));
  fs.mkdirSync(workDir, { recursive: true });
  const cacheDir = path.join(workDir, "cache");
  if (attempt > 1) fs.rmSync(cacheDir, { recursive: true, force: true });
  const args = igorArgs({
    project: p.yypPath,
    runtimePath: s.runtimePath,
    userFolder: s.userFolder,
    mode: "Compile",
    cacheDir,
  });
  const res = await runIgor(s.igorPath, args, { cwd: workDir, timeoutMs: 10 * 60 * 1000 });
  const info = parseIgorOutput(res.stdout, res.stderr);
  const combined = res.stdout + "\n" + res.stderr;

  // Igor occasionally crashes with a flaky .NET AccessViolationException while
  // parsing .yy files (independent of our project). Retry with a fresh cache.
  const flaky = /AccessViolationException|Fatal error\. System/i.test(combined);
  if (flaky && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1500));
    return doBuild(attempt + 1);
  }

  const outDir = outputDir(workDir, p.name);
  lastBuild = {
    ok: res.ok,
    code: res.code,
    timedOut: res.timedOut,
    outputDir: outDir,
    workDir,
    installPath: info.installPath,
    errors: info.errors,
    stats: info.stats,
    attempts: attempt,
    logTail: combined.split(/\r?\n/).slice(-40).join("\n"),
  };
  return lastBuild;
}

server.registerTool(
  "gm_build",
  {
    title: "Build the project (release)",
    description:
      "Compile the active project with the Igor CLI (macOS, release build). Returns compile errors, stats and output paths. Debug builds wait for a debugger, so CLI builds are release builds - use the bridge for live introspection.",
    inputSchema: {},
  },
  wrap(async () => {
    const b = await doBuild();
    return ok({
      ok: b.ok,
      exitCode: b.code,
      timedOut: b.timedOut,
      errors: b.errors,
      stats: b.stats,
      outputDir: b.outputDir,
      installPath: b.installPath,
      logTail: b.logTail,
    });
  }),
);

server.registerTool(
  "gm_run_game",
  {
    title: "Build, launch and connect to the game",
    description:
      "Compile (unless skipBuild), stage and launch the game on macOS, then connect to the injected MCP bridge and return live game info. Requires gm_inject_bridge to have been injected once.",
    inputSchema: {
      skipBuild: z.boolean().optional().describe("Launch the last successful build without rebuilding."),
      port: z.number().int().min(1024).max(65535).optional().describe("Bridge port (default from settings)."),
    },
  },
  wrap(async ({ skipBuild = false, port }) => {
    const p = needProject();
    const s = getSettings();
    killGames(lastBuild?.installPath ?? macInstallDir(undefined, p.name));
    if (bridge) {
      bridge.close();
      bridge = null;
    }

    let b = lastBuild;
    if (!skipBuild) {
      b = await doBuild();
      if (!b.ok) {
        return bad(JSON.stringify({ stage: "build", exitCode: b.code, errors: b.errors, logTail: b.logTail }, null, 2));
      }
    }
    if (!b || !b.ok) throw new Error("No successful build available - call gm_build first.");

    const installDir = b.installPath ?? macInstallDir(undefined, p.name);
    ensureRunnerInstalled(installDir, b.outputDir);
    const staged = stageMacGame(b.outputDir, installDir);
    const logPath = path.join(b.workDir, "run.log");
    fs.writeFileSync(logPath, "");
    const pid = launchMacApp(staged.appPath, logPath);

    const bport = port ?? s.bridgePort;
    let client = null;
    let lastErr = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        client = await connectToGame(bport, 4);
        break;
      } catch (e) {
        lastErr = e;
        await sleep(1500);
      }
    }
    if (!client) {
      const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").split(/\r?\n/).slice(-25).join("\n") : "";
      return bad(
        `Game launched (pid ${pid}) but the MCP bridge did not respond on ports ${bport}..${bport + 3}.\n` +
          `Did you run gm_inject_bridge before building?\nLast error: ${lastErr?.message}\n--- run log ---\n${tail}`,
      );
    }
    bridge = client;
    const info = await client.info();
    saveArea = info.saveArea ?? null;
    lastRun = { pid, installDir, logPath, port: client.port, startedAt: Date.now() };
    return ok({ ok: true, pid, bridgePort: client.port, installDir, logPath, info });
  }),
);

server.registerTool(
  "gm_stop_game",
  {
    title: "Stop the running game",
    description: "Kill the launched game process and close the bridge connection.",
    inputSchema: {},
  },
  wrap(async () => {
    const p = needProject();
    const installDir = lastRun?.installDir ?? lastBuild?.installPath ?? macInstallDir(undefined, p.name);
    const killed = killGames(installDir);
    if (bridge) {
      bridge.close();
      bridge = null;
    }
    return ok({ killed });
  }),
);

server.registerTool(
  "gm_read_game_log",
  {
    title: "Read the game run log",
    description: "Tail the stdout/debug log captured from the last game launch (includes runtime errors).",
    inputSchema: { lines: z.number().int().positive().max(500).optional().describe("Default 60.") },
  },
  wrap(async ({ lines = 60 }) => {
    if (!lastRun?.logPath || !fs.existsSync(lastRun.logPath)) {
      throw new Error("No run log yet - launch the game with gm_run_game first.");
    }
    const all = fs.readFileSync(lastRun.logPath, "utf8").split(/\r?\n/);
    return ok(all.slice(-lines).join("\n"));
  }),
);

server.registerTool(
  "gm_read_runtime_error",
  {
    title: "Read the last runtime error",
    description:
      "Read mcp_bridge_error.txt from the game save area (written by the bridge's unhandled-exception handler).",
    inputSchema: {},
  },
  wrap(async () => {
    const area = saveArea ?? defaultSaveArea();
    const file = path.join(area, "mcp_bridge_error.txt");
    if (!fs.existsSync(file)) return ok(`(no runtime error recorded at ${file})`);
    return ok(fs.readFileSync(file, "utf8"));
  }),
);

/* ------------------------------------------------------------------ */
/* Live bridge tools (require a running game from gm_run_game)         */
/* ------------------------------------------------------------------ */

server.registerTool(
  "gm_bridge_info",
  {
    title: "Live game info",
    description: "Query the running game: room, fps, room size, instance count, save area, working directory.",
    inputSchema: {},
  },
  wrap(async () => ok(await needBridge().info())),
);

server.registerTool(
  "gm_bridge_get_globals",
  {
    title: "Read global variables",
    description: "Read global variables from the running game (values are JSON-decoded; objects/arrays are included).",
    inputSchema: { names: z.array(z.string()).describe("Global variable names.") },
  },
  wrap(async ({ names }) => ok(await needBridge().getGlobals(names))),
);

server.registerTool(
  "gm_bridge_set_globals",
  {
    title: "Set global variables",
    description: "Set global variables in the running game (numbers, strings, arrays, structs).",
    inputSchema: { values: z.record(z.any()).describe("name -> value map.") },
  },
  wrap(async ({ values }) => ok(await needBridge().setGlobals(values))),
);

server.registerTool(
  "gm_bridge_list_instances",
  {
    title: "List live instances",
    description: "List instances in the running game (optionally filtered by object), with selected fields.",
    inputSchema: {
      object: z.string().optional().describe("Object name filter, e.g. obj_player."),
      fields: z.array(z.string()).optional().describe('Variables to fetch, e.g. ["x","y","hp"]. Default x,y.'),
      limit: z.number().int().positive().max(2000).optional(),
    },
  },
  wrap(async (a) => ok(await needBridge().listInstances(a))),
);

server.registerTool(
  "gm_bridge_get_instance",
  {
    title: "Inspect a live instance",
    description: "Read all variables of one instance in the running game (by numeric id from gm_bridge_list_instances).",
    inputSchema: { id: z.number().describe("Instance id.") },
  },
  wrap(async ({ id }) => ok(await needBridge().getInstance(id))),
);

server.registerTool(
  "gm_bridge_set_instance",
  {
    title: "Modify a live instance",
    description: "Set variables on a live instance (e.g. x, y, image_index, visible, hp).",
    inputSchema: { id: z.number(), values: z.record(z.any()) },
  },
  wrap(async ({ id, values }) => ok(await needBridge().setInstance(id, values))),
);

server.registerTool(
  "gm_bridge_create_instance",
  {
    title: "Create a live instance",
    description: "Create an instance of an object in the running game at (x, y) on a layer (or depth).",
    inputSchema: {
      object: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      layer: z.string().optional(),
      depth: z.number().optional(),
    },
  },
  wrap(async ({ object, x = 0, y = 0, layer, depth }) =>
    ok(await needBridge().createInstance(object, x, y, { layer, depth })),
  ),
);

server.registerTool(
  "gm_bridge_destroy_instance",
  {
    title: "Destroy a live instance",
    description: "Destroy an instance in the running game by id.",
    inputSchema: { id: z.number() },
  },
  wrap(async ({ id }) => ok(await needBridge().destroyInstance(id))),
);

server.registerTool(
  "gm_bridge_change_room",
  {
    title: "Change the live room",
    description: "Make the running game go to another room.",
    inputSchema: { room: z.string() },
  },
  wrap(async ({ room }) => ok(await needBridge().changeRoom(room))),
);

server.registerTool(
  "gm_bridge_restart_room",
  {
    title: "Restart the active room",
    description: "Restart the currently running room in the active game (room_restart()).",
    inputSchema: {},
  },
  wrap(async () => ok(await needBridge().restartRoom())),
);

server.registerTool(
  "gm_bridge_restart_game",
  {
    title: "Restart the running game",
    description: "Restart the running game from the beginning (game_restart()).",
    inputSchema: {},
  },
  wrap(async () => ok(await needBridge().restartGame())),
);

server.registerTool(
  "gm_bridge_call",
  {
    title: "Call a game function",
    description:
      "Call a global/script function in the running game by name with an argument array (result is returned if serialisable).",
    inputSchema: {
      function: z.string().describe("Function name, e.g. my_script_function."),
      args: z.array(z.any()).optional().describe("Arguments array."),
    },
  },
  wrap(async ({ function: fn, args }) => ok(await needBridge().callFunction(fn, args ?? []))),
);

server.registerTool(
  "gm_bridge_eval",
  {
    title: "Evaluate GML code at runtime",
    description:
      "Evaluate a GML expression/statement string in the running game. Requires the game to define a global function __mcp_eval(code) or execute_string (e.g. from the community execute_string library); returns an explanatory error otherwise.",
    inputSchema: { code: z.string() },
  },
  wrap(async ({ code }) => ok(await needBridge().evalCode(code))),
);

server.registerTool(
  "gm_bridge_key",
  {
    title: "Simulate key input",
    description:
      'Press/release/clear a key in the running game. Names: "A".."Z", "0".."9", "space", "left", "right", "up", "down", "enter", "escape", "shift", "control", "alt", "F1".."F12", or raw key code.',
    inputSchema: {
      key: z.union([z.string(), z.number()]),
      action: z.enum(["press", "release", "clear"]).optional(),
    },
  },
  wrap(async ({ key, action }) => ok(await needBridge().key(key, action ?? "press"))),
);

server.registerTool(
  "gm_bridge_set_mouse",
  {
    title: "Set mouse position",
    description:
      "Set the mouse cursor position in the running game window (window_mouse_set(x, y)).",
    inputSchema: {
      x: z.number().describe("Window X coordinate."),
      y: z.number().describe("Window Y coordinate."),
    },
  },
  wrap(async ({ x, y }) => ok(await needBridge().setMouse(x, y))),
);

server.registerTool(
  "gm_bridge_logs",
  {
    title: "Read bridge logs",
    description:
      "Read bridge log lines from the running game (connections, custom mcp_bridge_log() calls, unhandled exceptions).",
    inputSchema: {
      since: z.number().int().nonnegative().optional().describe("Return entries from this index (from a previous call)."),
    },
  },
  wrap(async ({ since = 0 }) => ok(await needBridge().logs(since))),
);

server.registerTool(
  "gm_bridge_set_speed",
  {
    title: "Set game speed",
    description: "Change the fps of the running game (useful for slow motion / fast-forward debugging).",
    inputSchema: { fps: z.number().positive().max(1000) },
  },
  wrap(async ({ fps }) => ok(await needBridge().setSpeed(fps))),
);

server.registerTool(
  "gm_bridge_screenshot",
  {
    title: "Screenshot the running game",
    description:
      "Capture the game window and return it as an image (PNG) that the model can look at. Files are written to the macOS save area.",
    inputSchema: {
      path: z
        .string()
        .optional()
        .describe("File name inside the save area (default mcp_screenshot_<timestamp>.png)."),
    },
  },
  wrap(async ({ path: relPath }) => {
    const b = needBridge();
    const name = relPath ?? `mcp_screenshot_${Date.now()}.png`;
    const r = await b.screenshot(name);
    if (!r.ok) return bad(r.error ?? "screenshot failed");
    const area = r.saveArea ?? saveArea ?? defaultSaveArea();
    const file = path.join(area, name);
    let data = null;
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(file)) {
        const stat = fs.statSync(file);
        if (stat.size > 0) {
          data = fs.readFileSync(file);
          break;
        }
      }
      await sleep(150);
    }
    if (!data) return bad(`Screenshot requested (${file}) but the file did not appear.`);
    return {
      content: [
        { type: "image", data: data.toString("base64"), mimeType: "image/png" },
        { type: "text", text: file },
      ],
    };
  }),
);

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

  return server;
}

/* ------------------------------------------------------------------ */
/* Transports + entry point                                            */
/* ------------------------------------------------------------------ */

/**
 * Serve the same tools over streamable HTTP so remote-capable MCP clients
 * (web agents, containerized runners, other machines on your LAN) can connect.
 * Stateful sessions (Mcp-Session-Id) per the MCP spec; one shared project /
 * bridge state per process.
 */
async function runHttp(port, host = process.env.GAMEMAKER_MCP_HTTP_HOST ?? "127.0.0.1") {
  /** sessionId -> { transport, server } */
  const sessions = new Map();

  const httpServer = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Last-Event-ID");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!req.url || !req.url.startsWith("/mcp")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Not found - POST to /mcp" } }));
      return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;

    const sessionHeader = req.headers["mcp-session-id"];
    try {
      let entry = sessionHeader ? sessions.get(String(sessionHeader)) : undefined;

      // GET (SSE stream) and DELETE (terminate session) reuse the session transport
      if (req.method === "GET" || req.method === "DELETE") {
        if (!entry) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "No valid session" } }));
          return;
        }
        await entry.transport.handleRequest(req, res);
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed - use POST" } }));
        return;
      }

      let parsed;
      try {
        parsed = body ? JSON.parse(body) : undefined;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
        return;
      }

      if (!entry && !sessionHeader && isInitializeRequest(parsed)) {
        // new session
        const srv = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, server: srv });
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await srv.connect(transport);
        entry = { transport, server: srv };
      }

      if (!entry) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message: "Bad request: no valid session - send an initialize request first" },
          }),
        );
        return;
      }

      await entry.transport.handleRequest(req, res, parsed);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32603, message: String(err?.message ?? err) },
          }),
        );
      }
    }
  });

  await new Promise((resolve) => httpServer.listen(port, host, resolve));
  const addr = httpServer.address();
  const shownHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.error(`gamemaker-mcp HTTP transport ready on http://${shownHost}:${addr.port}/mcp`);
  console.error("(point remote-capable MCP clients at that URL; stdio clients keep using `node src/index.js`)");
}

function printHelp() {
  console.log(`gamemaker-mcp - MCP server for GameMaker (macOS, LTS 2026 / 2024.x)

Usage:
  gamemaker-mcp [--http [port]] [--help]

Transports:
  (default)            stdio - used when an MCP client spawns this process
  --http [port]        streamable HTTP on http://127.0.0.1:<port>/mcp  (default port 8737,
                       env GAMEMAKER_MCP_HTTP_PORT; host via GAMEMAKER_MCP_HTTP_HOST)

Configuration (auto-detected, all optional):
  env vars             GAMEMAKER_PROJECT   path to a .yyp to open on start
                       GAMEMAKER_RUNTIME   GameMaker runtime folder
                       GAMEMAKER_IGOR      Igor CLI binary
                       GAMEMAKER_USER_FOLDER  GameMaker user folder (licence)
                       GAMEMAKER_PROJECTS_DIR default folder for gm_list_projects
                       GAMEMAKER_MCP_PORT  live game bridge port (default 18253)
  config file          ~/.gamemaker-mcp.json with the same keys (lowerCamelCase):
                       { "project", "runtimePath", "igorPath", "userFolder",
                         "projectsDir", "bridgePort" }

Tools: 52 (see README.md / docs/tools.md). Check detection with the gm_runtime_info tool.`);
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

const settings = getSettings();
if (settings.projectPath && fs.existsSync(settings.projectPath)) {
  try {
    project = new GMProject(settings.projectPath);
    console.error(`gamemaker-mcp: auto-opened project ${project.name}`);
  } catch (e) {
    console.error(`gamemaker-mcp: could not auto-open ${settings.projectPath}: ${e.message}`);
  }
}

const httpIdx = argv.indexOf("--http");
if (httpIdx >= 0) {
  const next = argv[httpIdx + 1];
  const portArg = next && !String(next).startsWith("-") ? Number(next) : undefined;
  await runHttp(portArg ?? Number(process.env.GAMEMAKER_MCP_HTTP_PORT ?? 8737));
} else {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`gamemaker-mcp ready on stdio (igor: ${settings.igorPath ?? "NOT FOUND"})`);
}

