// Environment discovery for GameMaker on this machine: runtimes, Igor CLI,
// user folder (licence), recent projects, bridge port.
//
// Resolution order for every setting:
//   1. environment variable (GAMEMAKER_*)
//   2. ~/.gamemaker-mcp.json
//   3. auto-detection

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

export const DEFAULTS = {
  bridgePort: 18253, // 0x474D == "GM"
};

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function firstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

export function readConfigFile() {
  const p = path.join(HOME, ".gamemaker-mcp.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/** Guess the Igor CLI path inside a runtime folder, for this or any OS. */
export function igorFor(runtimeDir) {
  const candidates = [
    path.join(runtimeDir, "bin", "igor", "osx", "arm64", "Igor"),
    path.join(runtimeDir, "bin", "igor", "osx", "x86_64", "Igor"),
    path.join(runtimeDir, "bin", "igor", "linux", "x64", "Igor"),
    path.join(runtimeDir, "bin", "igor", "windows", "x64", "Igor.exe"),
  ];
  return firstExisting(candidates);
}

/** All runtime folders found in the standard shared locations. */
export function listRuntimes() {
  const roots = [];
  const shared = "/Users/Shared";
  for (const entry of safeReaddir(shared)) {
    if (entry.startsWith("GameMakerStudio2")) {
      roots.push(path.join(shared, entry, "Cache", "runtimes"));
    }
  }
  roots.push(path.join(HOME, ".local", "share", "GameMakerStudio2", "Cache", "runtimes"));
  roots.push("C:\\ProgramData\\GameMakerStudio2\\Cache\\runtimes");

  const found = [];
  for (const root of roots) {
    for (const entry of safeReaddir(root)) {
      if (entry.startsWith("runtime-")) {
        const dir = path.join(root, entry);
        found.push({
          version: entry.replace(/^runtime-/, ""),
          dir,
          igor: igorFor(dir),
          root,
        });
      }
    }
  }
  found.sort((a, b) => compareVersions(b.version, a.version)); // newest first
  return found;
}

/** Version of the runtime marked "active" in runtime.json (per shared root). */
export function activeRuntimeVersion() {
  const shared = "/Users/Shared";
  for (const entry of safeReaddir(shared)) {
    if (!entry.startsWith("GameMakerStudio2")) continue;
    const file = path.join(shared, entry, "runtime.json");
    if (!fs.existsSync(file)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (j.active) return j.active;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** GameMaker IDE installs in /Applications (macOS). */
export function listIDEInstalls() {
  return safeReaddir("/Applications")
    .filter((e) => /^GameMaker.*\.app$/i.test(e))
    .map((e) => ({ name: e, path: path.join("/Applications", e) }));
}

/** Candidate per-user GameMaker config folders (they hold licence.plist). */
export function listUserFolders() {
  const base = path.join(HOME, "Library", "Application Support", "GameMakerStudio2");
  return safeReaddir(base)
    .map((e) => path.join(base, e))
    .filter((p) => {
      try {
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "licence.plist"));
      } catch {
        return false;
      }
    });
}

/** Project paths from the IDE's recent_projects file (newest first). */
export function recentProjects() {
  const out = [];
  for (const uf of listUserFolders()) {
    const f = path.join(uf, "recent_projects");
    if (!fs.existsSync(f)) continue;
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      if (line.endsWith(".yyp") && !out.includes(line)) out.push(line);
    }
  }
  return out;
}

/**
 * Full resolved settings.
 * @returns {{
 *   runtimePath?: string, igorPath?: string, userFolder?: string,
 *   licenceFile?: string, projectPath?: string, projectsDir?: string,
 *   bridgePort: number, runtimes: ReturnType<typeof listRuntimes>,
 *   ideInstalls: ReturnType<typeof listIDEInstalls>,
 * }}
 */
export function getSettings() {
  const file = readConfigFile();
  const env = process.env;
  const runtimes = listRuntimes();

  // Prefer (1) explicit override, (2) the newest runtime - the LTS 2026 IDE
  // ships/uses 2026.x runtimes and can still build older project formats.
  const runtimePath = firstExisting([
    env.GAMEMAKER_RUNTIME,
    file.runtimePath,
    runtimes[0]?.dir,
  ]);

  const igorPath = firstExisting([
    env.GAMEMAKER_IGOR,
    file.igorPath,
    runtimePath ? igorFor(runtimePath) : undefined,
    runtimes.find((r) => r.igor)?.igor,
  ]);

  const userFolder = firstExisting([
    env.GAMEMAKER_USER_FOLDER,
    file.userFolder,
    ...listUserFolders(),
  ]);

  const licenceFile = firstExisting([
    env.GAMEMAKER_LICENCE,
    file.licenceFile,
    userFolder ? path.join(userFolder, "licence.plist") : undefined,
  ]);

  const projectPath = env.GAMEMAKER_PROJECT || file.project || undefined;
  const projectsDir = firstExisting([
    env.GAMEMAKER_PROJECTS_DIR,
    file.projectsDir,
    path.join(HOME, "GameMakerProjects"),
    path.join(HOME, "Documents", "GameMakerProjects"),
    path.join(HOME, "GameMakerStudio2"),
    path.join(HOME, "Documents", "GameMakerStudio2"),
  ]);

  const bridgePort = Number(env.GAMEMAKER_MCP_PORT || file.bridgePort) || DEFAULTS.bridgePort;

  return {
    runtimePath,
    igorPath,
    userFolder,
    licenceFile,
    projectPath,
    projectsDir,
    bridgePort,
    runtimes,
    ideInstalls: listIDEInstalls(),
  };
}
