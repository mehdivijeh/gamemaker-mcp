# Contributing

Thanks for wanting to improve gamemaker-mcp! Every contribution is welcome —
bug reports as much as code.

## Good first issues

- **Windows / Linux support** — Igor invocation + runner staging are
  macOS-specific (`src/igor.js`, `stageMacGame`, `launchMacApp`,
  `ensureRunnerInstalled`). The project layer is OS-independent already.
- **Collision events** — figure out the `eventNum` hashing GameMaker uses for
  `Collision_<hash>.gml` and add it to `src/events.js`.
- **Sprite-sheet slicing** — `gm_import_sprite_sheet {png, frameWidth, frameHeight}`
  (the runtime ships ffmpeg at `<runtime>/bin/ffmpeg/macos/ffmpeg`).
- **`__mcp_eval` wrapper script** — vendor a tiny GML eval helper or generate an
  integration for the `execute_string` library.
- **HTTP auth / token** — optional bearer token for `--http` mode.
- **More client docs** — tested setup snippets for more MCP hosts.

## Development

```sh
git clone https://github.com/mehdivijeh/gamemaker-mcp
cd gamemaker-mcp
npm install

npm test                     # 24 unit tests — no GameMaker required
node test/mcp-handshake.mjs  # MCP protocol + tool registration
node test/http.test.mjs      # streamable HTTP transport
node test/e2e-gamemaker.mjs  # full loop (needs GameMaker + runtime on macOS)
node demo/mcp-demo.mjs       # showcase: build + drive a demo project live
```

No build step — plain ESM JavaScript. Runtime dependencies stay minimal
(`@modelcontextprotocol/sdk`, `zod`) — please don't add more without a very
good reason.

## Adding a tool

1. Register it in `src/index.js` inside `createServer()` with
   `server.registerTool(name, { title, description, inputSchema }, wrap(handler))`.
2. `description` should tell a model *when* to use it; `inputSchema` uses zod.
3. Return `ok(payload)` (JSON-able) or `bad("message")` for errors.
4. Pure logic belongs in the modules (`project.js`, `creators.js`, `igor.js`,
   `bridge.js`) so it can be unit-tested without MCP.
5. Add a test (`test/*.test.js` for pure logic; extend
   `test/mcp-handshake.mjs`'s required list for critical tools) and a line in
   `docs/tools.md`.

## Verifying against GameMaker

The repo's history documents the "probe" technique: add a throwaway object to
a copy of a project under `/tmp`, print/inspect values from a real run via
`test/debug-run.mjs`, and never touch the user's original project. Please keep
that discipline — tests must run on copies.

## Pull requests

- Keep the change focused; describe *what GameMaker version* you verified on.
- Update README/docs when behavior or setup changes.
- `npm test` must stay green; run the e2e if you touched `igor.js`,
  `gml/`, or the bridge client.

## Code of conduct

Be kind, be patient, assume good faith. GameMaker is a trademark of YoYo Games —
keep the project clearly unofficial (see the README disclaimer) and don't ship
GameMaker assets in the repo.
