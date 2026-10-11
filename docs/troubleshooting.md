# Troubleshooting

## Setup & detection

**"Igor CLI not found" / wrong runtime**
Run `gm_runtime_info` and check the paths. Pin the right ones in
`~/.gamemaker-mcp.json`:

```json
{
  "runtimePath": "/Users/Shared/GameMakerStudio2-LTS2026/Cache/runtimes/runtime-2026.0.0.23",
  "igorPath": "…/bin/igor/osx/arm64/Igor",
  "userFolder": "~/Library/Application Support/GameMakerStudio2/<user>_<id>",
  "project": "/path/to/MyGame.yyp"
}
```

**The server “failed” in my client**
Run it by hand: `node /path/to/gamemaker-mcp/src/index.js` — it should print
`gamemaker-mcp ready on stdio (igor: …)` and wait. Common causes: relative path
in the client config (must be absolute), `node` not on the client's PATH (use
`/usr/local/bin/node`), or the client needs a restart.

**Node version** — requires Node ≥ 20. `node --version`.

## Building

**Igor crashed while “Found Project Format 2”**
That's the known flaky .NET `AccessViolationException`. The server already sets
`DOTNET_PROCESSOR_COUNT=1` and retries automatically (check `attempts` in the
`gm_build` result). If it persists: close the GameMaker IDE, delete
`~/.gamemaker-mcp/build/<project>/cache`, retry.

**Compile errors**
`gm_build` returns `errors: [{message, file, line}]` and a `logTail`. Ask the
model to fix and rebuild — it can read the GML itself via `gm_read_gml`.

**“Runner app not installed”**
Run the project once from the GameMaker IDE (installs `YoYo Runner.app`), or
just call `gm_run_game` — it copies a runner from another project/runtime
template automatically when possible.

**Game builds but nothing happens**
CLI launches are **release** builds (debug builds wait for the IDE debugger by
design). Watch the run log with `gm_read_game_log`.

## Live bridge

**“Not connected to a running game”**
Launch with `gm_run_game` first. Make sure `gm_inject_bridge` ran **before** the
build — after injecting, rebuild so the bridge is inside the game.

**Bridge doesn't come up**
`gm_read_game_log` — look for GML compile errors or
`Attempted to read from outside the buffer` (shouldn't happen — the bridge
handles it). Confirm the game window is actually running (macOS firewall prompt
allowed on first run).

**Port already in use / several games**
The bridge automatically uses the next free port (18253 + N) and the client
scans the same range — just re-run `gm_run_game`.

**`gm_bridge_eval` says “not available”**
Add the community
[`execute_string`](https://github.com/GameMakerDiscord/execute_string) library
(or any `global.__mcp_eval = function(code) { … }` implementation) to the game.

**Runtime error instead of a crash**
That's the bridge's `exception_unhandled_handler` at work — read it with
`gm_read_runtime_error` and `gm_bridge_logs`; the game was ended deliberately.

## Remote / HTTP mode

- Endpoint is `http://<host>:<port>/mcp` (streamable HTTP, sessions via
  `Mcp-Session-Id`). Clients must send `Accept: application/json, text/event-stream`.
- Binds to `127.0.0.1` by default; set `GAMEMAKER_MCP_HTTP_HOST=0.0.0.0` for LAN
  (no auth — use a trusted network or a tunnel/proxy).
- All clients share one server process state (active project, bridge). Run
  multiple servers on different ports if you need isolation.

## Working alongside the GameMaker IDE

- The IDE can stay open, but if you **save in the IDE** while the model has
  unsaved tool edits, the IDE's version wins. Close the project in the IDE for
  large automated refactors, and reopen it afterwards (GameMaker reloads the
  files from disk).
- Sprite/Object editors are safest left closed for resources the model is
  rewriting.

## Cleanup / shipping

Ask the model (or do it manually):
- remove resources `mcp_bridge` (script) and `obj_mcp_bridge` (object) and its
  room instance — via `gm_delete_resource` + `gm_remove_instance`, or the IDE;
- rebuild from the IDE for a clean export.

The bridge is only ever added when **you** run `gm_inject_bridge`; it is not a
build dependency of the MCP server itself.
