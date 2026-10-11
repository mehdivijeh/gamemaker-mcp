# Changelog

## 0.1.0 — 2026-10-12

Initial release. Verified end-to-end against GameMaker **LTS 2026**
(IDE 2026.0.0.16, runtime 2026.0.0.23) on macOS.

### Features
- **42 MCP tools** across three layers: project editing, Igor build/run, and a
  live in-game bridge.
- **Project layer** — read/write scripts, objects + all event types, rooms,
  instances, room/instance creation code, sprites imported from PNGs (modern
  frame/layer/sequence layout), tolerant `.yy` relaxed-JSON reader/writer.
- **Build layer** — Igor CLI wrapper: release builds, structured compile
  errors, run/stop, log + runtime-error readers, automatic staging into
  `YoYo Runner.app`, automatic runner installation, retry on the flaky
  .NET `AccessViolationException`, `DOTNET_PROCESSOR_COUNT=1` workaround.
- **Live bridge** — pure-GML bridge (script + persistent object) speaking
  newline-JSON over a **raw TCP** server: globals, instances (read/write/
  create/destroy), rooms, function calls, optional `eval`, key injection,
  game speed, logs, screenshots (returned to the model as images), and an
  unhandled-exception handler that replaces blocking error dialogs.
- **Transports** — stdio (default) and **streamable HTTP** (`--http [port]`,
  stateful sessions, CORS, localhost by default).
- **Docs** — README, `docs/clients.md` (10+ MCP clients), `docs/tools.md`,
  `docs/usage.md`, `docs/protocol.md`, `docs/internals.md`,
  `docs/troubleshooting.md`.
- **Tests** — 24 unit tests, MCP handshake test, HTTP transport test, and a
  full end-to-end test against a real GameMaker install.
- **Demo** — `demo/mcp-demo.mjs` builds a project from scratch through the
  tools and drives it live (screenshots included).

### Reverse-engineered findings (documented in docs/internals.md)
- Async Networking event = `Other_68`; full async event table.
- `network_create_server` sockets require a proprietary `GM:Studio-Connect`
  login handshake; **`network_create_server_raw`** bypasses it.
- `network_socket_accept` / `network_set_nonblocking` don't exist in LTS 2026.
- The async data buffer is shared across instances (owner-instance pattern).
- Game writes land in the macOS save area; `file_text_*` writes silently fail
  (use `buffer_save`); `real("bad string")` throws; instance refs render as
  `ref instance N` / `"@ref instance(N)"`.
- Debug builds wait for a debugger — CLI launches use release builds.
