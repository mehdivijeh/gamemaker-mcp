# Under the hood — how this server talks to GameMaker

Everything here was verified empirically against **GameMaker LTS 2026
(2026.0.0.16, runtime 2026.0.0.23) on macOS** with real Igor builds and real
game runs. Model versions may change details; the numbers below are great
starting points when they do.

## The three layers

### 1. Project layer — GameMaker files are "relaxed JSON"

- A project is `<name>.yyp` (project file, lists every resource as
  `{id: {name, path}}`), one folder per resource type (`scripts/`, `objects/`,
  `rooms/`, `sprites/`…), each containing `<Name>.yy` + content.
- GameMaker writes **JSON with trailing commas** (`{"a":1,},`). The server
  strips them with a string-aware scanner (`src/yy.js`) and writes plain JSON —
  the IDE/Igor accept both.
- **Event files** are named `<Type>_<num>.gml`: `Create_0`, `Step_0`/`Step_1`/
  `Step_2` (begin/end), `Draw_0` / `Draw_64` (GUI) / `Draw_72…77`, `Alarm_N`,
  `KeyPress_32`, `CleanUp_0`… **Async Networking is `Other_68`**
  (manual: `EVENT_OTHER_WEB_NETWORKING = 68`; the full async table:
  60 image-loaded / 61 sound / 62 http / 63 dialog / 66 IAP / 67 cloud /
  **68 networking** / 69 steam / 70 social / 71 push / 72 save-load /
  73 audio-rec / 74 audio-playback / 75 system / 76 broadcast).
- Collision events use a **hash of the target object's name** as `eventNum` —
  not reproducible safely, so the tool refuses them by name.
- Modern sprites store each frame as `<frameGuid>.png` at the sprite root plus
  `layers/<frameGuid>/<layerGuid>.png`, with a `GMSequence` track in the `.yy`.
  `gm_import_sprite` generates exactly that layout (verified by compiling).
- Room creation code lives in `rooms/<room>/RoomCreationCode.gml`;
  per-instance code in `InstanceCreationCode_<instName>.gml`.

### 2. Build layer — Igor CLI on macOS

- Igor: `<runtime>/bin/igor/osx/arm64/Igor` (a directory layout, not a file —
  the binary is inside). Flags used: `--project`, `--rp` (runtime), `--uf`
  (user folder with `licence.plist`), `-r=VM|YYC`, `--cache`, `--cr`
  (console redirect), `--jsonErrors`, then worker+command: `mac Compile`,
  `mac Run`, `mac Stop`.
- **Debug builds wait forever for a debugger connection** (`--debug` builds
  print "Waiting for debugger to connect..." and the game never starts when
  launched from a terminal). CLI runs therefore use **release builds**; the
  in-game bridge replaces the debugger.
- Igor occasionally crashes with a flaky .NET
  `System.AccessViolationException` inside its concurrent `.yy` parser
  (`…ParseAssistFloatingPointExtensions.IsFloat…`). It is unrelated to the
  project content, happens even on stock template projects, and is greatly
  suppressed by `DOTNET_PROCESSOR_COUNT=1`; the server sets that and also
  **auto-retries** up to 3 times with a fresh cache.
- Output: `<cwd>/output/<project>/` with `game.ios`, `options.ini`,
  `install_dmg.sh` and a `game.zip`. Igor also installs the runtime's
  **`YoYo Runner.app`** into the project's `remote_install_path`
  (`~/GameMakerStudio2/GM_MAC/<project>`). When that hasn't happened yet, the
  server copies a runner from another installed project or from
  `<runtime>/mac/YoYo Runner.app`.
- **Launching**: the built `game.ios` + `options.ini` are copied into
  `<install>/YoYo Runner.app/Contents/Resources/` and `Contents/MacOS/Mac_Runner`
  is executed in-bundle (that's what the IDE does; `open`-based launches
  detached weirdly in testing). The runner writes everything to the
  `-output` log file — including GML errors, which the server surfaces.
### 3. Live layer — networking the hard way

- **Plain `network_create_server` TCP sockets are unusable from outside
  GameMaker.** On connect the runner sends a `GM:Studio-Connect\0` greeting and
  expects a proprietary login packet (`yyServer.cpp` strings in the runner).
  Anything else → `ERROR: login failed` +
  `WARNING: Discarding malformed data … mixing raw/non-raw network APIs?` and
  the socket dies before any GML event fires. WebSocket servers
  (`network_socket_ws`) complete a real RFC6455 handshake but **still** hit the
  login wall on the first message.
  → The bridge uses **`network_create_server_raw`**, which the manual confirms
  "will not accept nor use any of the built-in GameMaker data headers", i.e.
  plain TCP + `network_send_raw`. Verified end-to-end.
- `network_socket_accept` and `network_set_nonblocking` **do not exist** in LTS
  2026 — servers must rely on the Async Networking event (connect/disconnect/
  data events with an `async_load` map).
- The **async data buffer is shared across all instances** that have the event;
  a second reader hits "Attempting to read from outside the buffer" (a fatal
  error in LTS 2026). The bridge elects an **owner** instance and everyone else
  exits the event immediately.
- **File I/O**: legacy `file_text_*` writes silently fail in LTS 2026; use
  `buffer_save`. On macOS all game writes land inside the **save area**
  (`~/Library/Application Support/com.yoyogames.macyoyorunner/`) — that's where
  screenshots (`screen_save`) and `mcp_bridge_error.txt` appear.
- **References**: `string(instance)` prints `ref instance 100002` while
  `json_stringify` emits `"@ref instance(100002)"`; both are normalised back to
  plain numbers for JSON transport. Also: `real("not a number")` **throws** in
  LTS 2026 — always validate strings before converting.
- Error dialogs would block automated testing, so the bridge installs
  `exception_unhandled_handler` (logs + writes the error file + ends the game).

## Verification story

- 24 unit tests (no GameMaker needed) + MCP handshake + HTTP transport tests.
- `test/e2e-gamemaker.mjs` drives the real thing end to end: copy a project,
  inject the bridge, build with Igor, launch, then over the live bridge read
  info, round-trip globals (incl. unicode), create/list/destroy instances,
  call functions, inject keys, capture a screenshot — and stop the game.
- `demo/mcp-demo.mjs` builds a fresh project entirely through the MCP tools
  and drives it live (the screenshots in the README come from it).
- The probe technique used during development — writing test values to files /
  stdout from a tiny throwaway object — is documented in the commit history if
  you ever need to re-verify a constant on a new runtime version.
