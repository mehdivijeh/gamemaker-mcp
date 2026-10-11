// Debug helper: builds + launches the e2e project and LEAVES the game
// running so you can poke at the bridge manually:
//   node test/debug-run.mjs
//   lsof -iTCP -sTCP:LISTEN | grep -i runner
//   printf '{"id":"1","cmd":"ping","args":{}}\\n' | nc -w 3 127.0.0.1 18253
//   tail -f ~/.gamemaker-mcp/build/simple_platformer/run.log *

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GMProject } from "../src/project.js";
import { injectBridge } from "../src/creators.js";
import { getSettings } from "../src/config.js";
import { igorArgs, runIgor, parseIgorOutput, outputDir, stageMacGame, launchMacApp, killGames } from "../src/igor.js";

const GML_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "gml");
const projectPath = process.argv[2] ?? "/tmp/gm_e2e/probe_game/simple_platformer.yyp";

const project = new GMProject(projectPath);
console.log("project:", project.name);

killGames(undefined);

const bridgeInfo = injectBridge(project, { gmlDir: GML_DIR, port: 18253 });
console.log("bridge injected:", JSON.stringify(bridgeInfo));

const s = getSettings();
const workDir = path.join(os.homedir(), ".gamemaker-mcp", "build", project.name.replace(/[^\w.-]+/g, "_"));
fs.mkdirSync(workDir, { recursive: true });
const args = igorArgs({
  project: project.yypPath,
  runtimePath: s.runtimePath,
  userFolder: s.userFolder,
  mode: "Compile",
  cacheDir: path.join(workDir, "cache"),
});
console.log("building...");
const res = await runIgor(s.igorPath, args, { cwd: workDir, timeoutMs: 600000 });
const info = parseIgorOutput(res.stdout, res.stderr);
console.log("build ok:", res.ok, "errors:", info.errors.length);
if (!res.ok) {
  console.log(res.stdout.split(/\r?\n/).slice(-15).join("\n"));
  process.exit(1);
}

const outDir = outputDir(workDir, project.name);
const installDir = info.installPath ?? path.join(os.homedir(), "GameMakerStudio2", "GM_MAC", project.name);
const staged = stageMacGame(outDir, installDir);
const logPath = path.join(workDir, "run.log");
fs.writeFileSync(logPath, "");
const pid = launchMacApp(staged.appPath, logPath);
console.log("launched pid:", pid);
console.log("log:", logPath);

await new Promise((r) => setTimeout(r, 8000));
const tail = fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter((l) => /MCP|mcp_bridge|Client|ERROR/.test(l));
console.log("--- log highlights ---");
console.log(tail.slice(-25).join("\n"));
console.log("(game left running - test the bridge manually)");
