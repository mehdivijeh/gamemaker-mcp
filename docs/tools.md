# Tool reference — project & build

All tools return MCP content; JSON-shaped results are pretty-printed text.
Errors come back as `isError: true` with a readable message.
Event names are forgiving: `"Create"`, `"End Step"`, `"Draw GUI"`, `"Room Start"`,
`"Alarm 3"`, `"User 5"`, `"Outside View 2"`, `"Async - Networking"`, or raw
`"Other:68"` / `"Draw_64"` style. Collision events are intentionally not
creatable by name (GameMaker hashes the target object into the event id).

## Environment & projects

| Tool | Parameters | Returns |
| --- | --- | --- |
| `gm_runtime_info` | — | Igor path, runtime folders, user folder (licence), projects dir, bridge port, IDE installs, recent projects |
| `gm_list_projects` | `searchDir?` | recent projects + `.yyp` files under the folder (recursive, 4 levels) |
| `gm_open_project` | `path` (`.yyp` or folder or `X.yyp/X.yyp`) | project summary; becomes the active project |
| `gm_create_project` | `name`, `dir?`, `firstRoom?`, `width?`, `height?` | bootstrap a new valid project with standard folders and starting room; becomes active |
| `gm_close_project` | — | close active project and reset project state |
| `gm_project_summary` | — | name, IDE version, resource counts, room order |

## Reading & editing code

| Tool | Parameters | Returns |
| --- | --- | --- |
| `gm_list_resources` | `type?` (`script/object/room/sprite/...`) | `[{name, path, type}]` |
| `gm_read_resource` | `name` | `{file, yy}` — the raw parsed `.yy` JSON |
| `gm_search_gml` | `pattern` (regex), `type?`, `limit?` | matches with resource, file, line, text |
| `gm_read_gml` | `name`, `event?` | GML source of a script, or of one object event |
| `gm_write_gml` | `name`, `content`, `event?` | overwrites script/event (creates the event if missing) |

## Creating & deleting resources

| Tool | Parameters | Returns |
| --- | --- | --- |
| `gm_create_script` | `name`, `content?` | `{script, path}` |
| `gm_create_object` | `name`, `parentObject?`, `sprite?`, `persistent?`, `visible?` | `{object, path}` |
| `gm_get_object` | `object` | `{name, sprite, parentObject, visible, solid, persistent, events[]}` |
| `gm_set_object_properties` | `object`, `sprite?`, `parentObject?`, `visible?`, `solid?`, `persistent?` | updated object properties |
| `gm_delete_resource` | `name` | `{deleted}` — removes folder + project entry (careful!) |

## Object events

| Tool | Parameters | Returns |
| --- | --- | --- |
| `gm_list_object_events` | `object` | events with canonical names, file names, code sizes |
| `gm_set_object_event` | `object`, `event`, `code` | `{object, event, file}` (e.g. `Draw GUI → Draw_64.gml`) |
| `gm_remove_object_event` | `object`, `event` | removed event info |

## Rooms & instances

| Tool | Parameters | Returns |
| --- | --- | --- |
| `gm_create_room` | `name`, `width?` (1366), `height?` (768), `first?`, `persistent?` | `{room, path}` |
| `gm_get_room` | `room` | `{name, width, height, persistent, creationCodeFile, instanceCount, instances, layers}` |
| `gm_set_room_properties` | `room`, `width?`, `height?`, `persistent?` | `{name, width, height, persistent}` |
| `gm_set_first_room` | `room` | `{roomOrder}` — moves room to the start of the project's room order |
| `gm_list_room_instances` | `room` | instances with name, object, x, y, layer, creation-code flag |
| `gm_add_instance` | `room`, `object`, `x?`, `y?`, `layer?` (`"Instances"`), `creationCode?` | `{instance, room, object}` (`inst_XXXXXXXX` name) |
| `gm_remove_instance` | `room`, `instance` | `{removed}` |
| `gm_set_room_creation_code` | `room`, `code` (empty string clears) | `{creationCodeFile}` |

## Sprites

| Tool | Parameters | Returns |
| --- | --- | --- |
| `gm_import_sprite` | `name`, `frames` (absolute PNG paths, in playback order), `fps?` (30), `originX?`/`originY?` (center) | `{path, frames, width, height, originX, originY}` |

Writes the modern GameMaker layout: per-frame GUID `.png`s,
`layers/<frame>/<layer>.png`, plus a sprite sequence track.

## Build & run (Igor)

| Tool | Parameters | Returns |
| --- | --- | --- |
| `gm_build` | — | `{ok, exitCode, errors[], stats, outputDir, installPath, attempts, logTail}`. Detects Igor's flaky .NET crash and retries (up to 3 attempts). |
| `gm_run_game` | `skipBuild?`, `port?` | `{ok, pid, bridgePort, installDir, logPath, info}` — builds, stages into `YoYo Runner.app`, launches, connects the bridge |
| `gm_stop_game` | — | `{killed}` |
| `gm_read_game_log` | `lines?` (60) | tail of the launch log (stdout + engine output + GML errors) |
| `gm_read_runtime_error` | — | contents of `mcp_bridge_error.txt` from the save area (unhandled GML exceptions) |

Notes:
- CLI launches are **release builds** (debug builds wait for the IDE debugger).
- The first run per project stages the runner app (~30 s) — later runs are fast.
- `errors[]` entries are `{message, file?, line?}` when the compiler reports a location.
# Tool reference — live game bridge

All `gm_bridge_*` tools need a running game that was launched with
`gm_run_game` (or any run of a project that has the bridge injected).
The bridge is added with **`gm_inject_bridge`** — once per project, before
building. Values are JSON-encoded on the wire; arrays/structs round-trip.

| Tool | Parameters | Returns / examples |
| --- | --- | --- |
| `gm_bridge_info` | — | `{version, room, roomWidth, roomHeight, instances, fps, fpsReal, windowWidth, windowHeight, wd, saveArea, os, uptimeMs, logCount}` |
| `gm_bridge_get_globals` | `names: string[]` | `{values: {name: value}}`; missing globals come back as `{__missing: true}` |
| `gm_bridge_set_globals` | `values: object` | `{set: [names]}` — numbers, strings, arrays, structs |
| `gm_bridge_list_instances` | `object?` (name filter), `fields?: string[]` (default `x,y`), `limit?` (200) | `{instances: [{id, object, x, y, ...}], total}` — ids are plain numbers |
| `gm_bridge_get_instance` | `id` (number) | `{instance: {id, object, vars: {...}}}` — all non-method variables |
| `gm_bridge_set_instance` | `id`, `values: object` | `{set: [names]}` — e.g. `x`, `y`, `visible`, `image_index`, custom vars |
| `gm_bridge_create_instance` | `object`, `x?`, `y?`, `layer?` (auto), `depth?` | `{instance: <id>, object}` — falls back to `instance_create_depth` when the layer is missing |
| `gm_bridge_destroy_instance` | `id` | `{destroyed: true}` |
| `gm_bridge_change_room` | `room` | `{room}` — performs `room_goto` |
| `gm_bridge_restart_room` | — | `{room}` — restarts the active room (`room_restart()`) |
| `gm_bridge_restart_game` | — | `{restarted: true}` — restarts the entire game (`game_restart()`) |
| `gm_bridge_call` | `function`, `args?: any[]` | `{result?}` — `method_call` on any global/script function by name |
| `gm_bridge_eval` | `code` | `{result?}` — needs a global `__mcp_eval(code)` or `execute_string` in the game, else an explanatory error |
| `gm_bridge_key` | `key` (`"space"`, `"A"`…`"Z"`, `"0"`…`"9"`, `"left/up/right/down"`, `"enter/escape/shift/control/alt/tab/backspace/delete/home/end"`, `"F1"`…`"F12"`, or raw code), `action?` (`press`/`release`/`clear`) | `{key, action}` — injected into the game's keyboard state |
| `gm_bridge_set_mouse` | `x`, `y` | `{x, y, mouseX, mouseY}` — moves mouse in game window (`window_mouse_set(x, y)`) |
| `gm_bridge_set_speed` | `fps` | `{fps}` — great for slow-motion debugging |
| `gm_bridge_logs` | `since?` (index) | `{logs: string[], total}` — connections, `mcp_bridge_log()` calls, unhandled exceptions |
| `gm_bridge_screenshot` | `path?` (file name in save area) | **image content block** (PNG, base64) + the file path — models can literally look at your game |
| `gm_inject_bridge` | `port?` (18253) | `{script, object, firstRoom, instancePlaced, port}` — adds/refreshes the bridge |

## Details worth knowing

- **Ids are plain numbers** (e.g. `100002`) even though GameMaker renders
  references as `ref instance 100002` / `"@ref instance(100002)"` internally —
  the bridge normalizes them.
- **Screenshots** are written into the game's save area on macOS
  (`~/Library/Application Support/com.yoyogames.macyoyorunner/`) and returned to
  the model as an actual image, so it can interpret what it sees.
- **Errors instead of dialogs**: the bridge installs
  `exception_unhandled_handler`; unhandled GML exceptions are logged, written to
  `mcp_bridge_error.txt` and end the game — no blocking error window. Read them
  with `gm_read_runtime_error` / `gm_bridge_logs`.
- **Multiple bridge instances are safe**: async networking events run for every
  instance that has the event, so the bridge uses an "owner" instance that
  processes all traffic (the async buffer can only be read once).
- **eval**: GameMaker has no built-in `execute_string`; add the community
  [`execute_string`](https://github.com/GameMakerDiscord/execute_string) library
  or any `__mcp_eval(code)` wrapper to unlock `gm_bridge_eval` for arbitrary
  GML at runtime.
- **Ports**: default 18253; if taken the bridge tries +1…+32, and the client
  scans the same range, so multiple running games are handled automatically.
