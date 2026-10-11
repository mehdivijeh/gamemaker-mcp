# Using gamemaker-mcp — workflows & prompt library

This page is the practical guide. For installation see the [README](../README.md),
for per-client configs see [clients.md](clients.md), for every parameter see
[tools.md](tools.md).

The golden rule: **you don't call tools — you describe what you want.** The AI
client picks the tools. Below are patterns that work well.

---

## The golden workflow

**1. Open a project**

> "List my GameMaker projects, then open `Cover Assault`"

**2. Explore**

> "Show me every object that mentions `hp` in its Step events" (search + read)
> "What does obj_player's Create event do?" (read)

**3. Edit**

> "Add coyote time: a `coyote` counter in obj_player's Create event, set to 8 when
> on ground, decrement in Step, allow jumping while `coyote > 0`"

The model writes real GML through `gm_write_gml` / `gm_set_object_event`.

**4. Build**

> "Build the project"

Compile errors come back with **file + line** so the model can fix them itself.

**5. Inject the bridge (once per project)** and run

> "Inject the MCP bridge, then build and run the game"

**6. Interact live** (see below) — or just redirect:

> "Now play it for 10 seconds and tell me if anything looks broken."

---

## Live interactions — recipes

| Goal | Prompt |
| --- | --- |
| Inspect | "List every obj_enemy with hp < 50 and their positions" |
| Change state | "Set global.difficulty to 3, give the player 999 coins" |
| Teleport / fix | "obj_player is stuck at 0,0 — move it to 400,300" |
| Spawn | "Spawn 5 obj_coin instances around the player" |
| Call a function | "Call `demo_boost(5)`" (any global GML function by name) |
| Test input | "Hold right for 2 seconds, then tell me if x increased" |
| Look at it | "Screenshot the game" (the model sees the PNG) |
| Slow motion | "Set the game speed to 8 fps and screenshot again" |
| Room jump | "Load rm_boss live and screenshot what happens" |
| Watch values | "Read player.hp every second for 10 s and summarize the trend" (repeated `gm_bridge_get_instance`) |
| Crash triage | "The game closed. Read the runtime error and the game log, find the bug, fix it, rebuild, retest" |
| Regression test | "Start the game, hold space for 1 s, then verify `global.score` increased; if not, read logs and fix" |

---

## Making the most of it

- **Let the model see.** For visual work, always ask for screenshots at key
  moments — the server returns them as images, not file paths.
- **Fix → rebuild → retest loop.** After every code edit ask:
  *"rebuild and verify live that …"*. The whole loop takes seconds.
- **Keep the bridge out of game logic.** It's a dev harness; ask the model to
  "remove the MCP bridge" before exporting a build for other people.
- **Pin your project.** Create `~/.gamemaker-mcp.json`:
  ```json
  { "project": "/Users/you/GameMakerProjects/MyGame/MyGame.yyp", "bridgePort": 18253 }
  ```
  and the AI can skip `gm_open_project`.
- **Two games at once** is fine — the port fallback (+1…+32) keeps bridges
  separate; `gm_run_game` reconnects to whichever instance it launched.
- **Hand editing still works.** The IDE can be open while the AI edits files;
  just don't save over each other. Close the project in the IDE before a
  big automated refactor.

---

## Scripted automation (no AI client)

The server is also a normal Node module and a normal MCP server, so you can
drive it yourself:

- **MCP over stdio** — see `test/e2e-gamemaker.mjs` (spawn + JSON-RPC helpers)
- **MCP over HTTP** — `node src/index.js --http 8737`, then POST to
  `http://127.0.0.1:8737/mcp` (initialize → use `Mcp-Session-Id`)
- **Direct library use** — import from `src/` (what `demo/mcp-demo.mjs` does
  for the project layer)

`node demo/mcp-demo.mjs` is the full showcase: it creates a project via the
tools, builds, runs, and drives it live — a good template for CI-style checks.
