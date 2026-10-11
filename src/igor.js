// Igor CLI wrapper: build / run / stop GameMaker projects from the command line.
//
// Verified against GameMaker LTS 2026 (runtime 2026.0.0.23) on macOS:
//  - Igor lives at <runtime>/bin/igor/<os>/<arch>/Igor
//  - Syntax: Igor [OPTIONS] WORKER COMMAND   e.g. `mac Compile`, `mac Run`
//  - Builds are written to <cwd>/output/<projectname>/ ; release "Compile"
//    additionally writes game.zip with assets/game.ios + assets/options.ini.
//  - Debug builds wait for a debugger connection, so CLI launches use release
//    builds (the MCP game bridge provides live introspection instead).
//  - Launching on macOS: copy game.ios + options.ini into
//    "<installDir>/YoYo Runner.app/Contents/Resources/" and `open` the app.
//    The runner looks up the game at <bundle>/Contents/Resources/game.ios.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function igorArgs(opts) {
  const {
    project,
    runtimePath,
    userFolder,
    mode = "Compile",
    runtime = "VM",
    debug = false,
    debugPort = 6599,
    cacheDir,
    outputName,
  } = opts;

  const args = [`--project=${project}`];
  if (runtimePath) args.push(`--rp=${runtimePath}`);
  if (userFolder) args.push(`--uf=${userFolder}`);
  args.push(`-r=${runtime}`);
  if (debug) args.push("--debug", `--dbgp=${debugPort}`);
  args.push("--cr", "--jsonErrors");
  if (cacheDir) args.push(`--cache=${cacheDir}`);
  if (outputName) args.push(`--of=${outputName}`);
  args.push("mac", mode);
  return args;
}

/**
 * Run Igor and collect output.
 * @param {string} igorPath
 * @param {string[]} args
 * @param {{cwd?: string, timeoutMs?: number}} opts
 * @returns {Promise<{ok: boolean, code: number|null, timedOut: boolean, stdout: string, stderr: string}>}
 */
export function runIgor(igorPath, args, opts = {}) {
  const { cwd, timeoutMs = 300000 } = opts;
  return new Promise((resolve) => {
    // DOTNET_PROCESSOR_COUNT=1 works around a flaky AccessViolationException
    // in Igor's concurrent .yy file parser on some machines (verified on
    // macOS + LTS 2026: crashes with >= 2 processors, stable with 1).
    const child = spawn(igorPath, args, {
      cwd,
      env: { ...process.env, DOTNET_PROCESSOR_COUNT: process.env.DOTNET_PROCESSOR_COUNT || "1" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("close", (code) => {
      clearTimeout(timer);
      const ok = code === 0 && /Igor complete\./.test(stdout) && !hasErrors(stdout, stderr);
      resolve({ ok, code, timedOut, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, timedOut, stdout, stderr: stderr + String(err) });
    });
  });
}

function hasErrors(stdout, stderr) {
  const text = stdout + "\n" + stderr;
  return /\*\*\*+\s*Error|Compile Error|Failed to|error CS\d+/i.test(text);
}

/** Extract structured info from Igor's console output. */
export function parseIgorOutput(stdout, stderr) {
  const info = { errors: [], installPath: undefined, iffFile: undefined, stats: undefined };

  const install = stdout.match(/remote_install_path\s*:\s*(.+)\s*$/m);
  if (install) info.installPath = install[1].trim();
  const iff = stdout.match(/Saving IFF file\.\.\.\s*(.+)\s*$/m);
  if (iff) info.iffFile = iff[1].trim();
  const stats = stdout.match(/Stats\s*:\s*GMA\s*:\s*(.+)$/m);
  if (stats) info.stats = stats[1].trim();

  // --jsonErrors prints error structs on stderr
  for (const line of stderr.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      try {
        info.errors.push(JSON.parse(t));
      } catch {
        /* not JSON */
      }
    }
  }
  if (info.errors.length === 0) {
    for (const line of (stdout + "\n" + stderr).split(/\r?\n/)) {
      if (/error/i.test(line) && /\.gml|Error|error CS/i.test(line)) {
        const m = line.match(/([^\s:()]+\.gml)[:(](\d+)/);
        info.errors.push(
          m ? { message: line.trim(), file: m[1], line: Number(m[2]) } : { message: line.trim() },
        );
      }
    }
  }
  return info;
}

/** Where build output goes when Igor runs with a given cwd. */
export function outputDir(workDir, projectName) {
  return path.join(workDir, "output", projectName);
}

/** macOS: locate the "YoYo Runner.app" install dir for a project. */
export function macInstallDir(parsedInstallPath, projectName) {
  if (parsedInstallPath && fs.existsSync(parsedInstallPath)) return parsedInstallPath;
  return parsedInstallPath ?? path.join(os.homedir(), "GameMakerStudio2", "GM_MAC", projectName);
}

/**
 * macOS: stage the freshly built game into the runner app bundle so it can
 * run standalone (this is what the IDE does under the hood).
 * @returns {{appPath: string, gameIos: string, optionsIni: string|null}}
 */
export function stageMacGame(outDir, installDir) {
  const assetsGame = path.join(outDir, "assets", "game.ios");
  const rootGame = path.join(outDir, "game.ios");
  const gameIos = fs.existsSync(assetsGame) ? assetsGame : rootGame;
  if (!fs.existsSync(gameIos)) {
    throw new Error(`Built game not found at ${gameIos} - did the build succeed?`);
  }
  const appPath = path.join(installDir, "YoYo Runner.app");
  if (!fs.existsSync(appPath)) {
    throw new Error(
      `Runner app not installed at ${appPath} - run the game once from the GameMaker IDE (or from Igor) so the runner gets installed.`,
    );
  }
  const res = path.join(appPath, "Contents", "Resources");
  fs.mkdirSync(res, { recursive: true });
  fs.copyFileSync(gameIos, path.join(res, "game.ios"));

  const assetsIni = path.join(outDir, "assets", "options.ini");
  const rootIni = path.join(outDir, "options.ini");
  let ini = null;
  if (fs.existsSync(assetsIni)) ini = assetsIni;
  else if (fs.existsSync(rootIni)) ini = rootIni;
  if (ini) fs.copyFileSync(ini, path.join(res, "options.ini"));

  return { appPath, gameIos, optionsIni: ini };
}

/** Launch a staged game app (detached) and return immediately. */
export function launchMacApp(appPath, logPath) {
  const args = [];
  if (logPath) args.push("--args", "-output", logPath, "-debugoutput", logPath);
  const child = spawn("open", [appPath, ...args], { detached: true, stdio: "ignore" });
  child.unref();
  return child.pid;
}

/** Find running game processes for an install dir. */
export function runningGames(installDir) {
  try {
    const out = execFileSync("/bin/ps", ["-axo", "pid,command"], { encoding: "utf8" });
    return out
      .split(/\r?\n/)
      .filter((l) => l.includes("Mac_Runner") && (!installDir || l.includes(installDir)))
      .map((l) => {
        const m = l.trim().match(/^(\d+)\s+(.*)$/);
        return m ? { pid: Number(m[1]), command: m[2] } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Kill running games for an install dir (SIGKILL). */
export function killGames(installDir) {
  const procs = runningGames(installDir);
  for (const p of procs) {
    try {
      process.kill(p.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  return procs.length;
}

