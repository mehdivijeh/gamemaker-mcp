# The in-game bridge protocol

`gm_inject_bridge` adds two resources to your project:

- `scripts/mcp_bridge/mcp_bridge.gml` — all bridge functions (~450 lines of GML)
- `objects/obj_mcp_bridge` — persistent, invisible object with **Create / Step /
  Async Networking (`Other_68`) / Clean Up** events, plus one instance placed in
  the first room

The object opens a TCP server when the game starts and speaks a tiny
newline-delimited JSON protocol. **No third-party libraries, no runtime
patches** — pure GML.

---

## Transport

| | |
| --- | --- |
| Socket | `network_create_server_raw(network_socket_tcp, port, 4)` |
| Framing | one JSON object per line (`\n` terminated), both directions |
| Requests | **ASCII-safe JSON** — non-ASCII is `\uXXXX`-escaped (the GML side reads request bytes one at a time) |
| Responses | UTF-8 JSON (safe to read as UTF-8 on the client side) |
| Default port | `18253`; if busy the bridge tries +1 … +32 (clients scan the same range) |
| Limits | 4 clients, 1 MB per request line, log capped at 300 entries |

> ⚠️ Why *raw*? GameMaker's regular `network_create_server` sockets require a
> proprietary `GM:Studio-Connect` login handshake first (see
> [internals.md](internals.md)); external clients get dropped with
> `ERROR: login failed`. The raw server has no such layer.

---

## Message shapes

Request:

```json
{"id":"7","cmd":"globals.get","args":{"names":["score"]}}
```

Success response (always echoes `id`):

```json
{"id":"7","ok":true,"values":{"score":120}}
```

Failure:

```json
{"id":"7","ok":false,"error":"instance not found: 55555"}
```

Invalid JSON gets `{"id":"?","ok":false,"error":"invalid JSON request"}`.

---

## Commands

| `cmd` | `args` | Result extras |
| --- | --- | --- |
| `ping` | — | `pong: true`, `port`, `handled` (command count) |
| `info` | — | `version, room, roomWidth, roomHeight, instances, fps, fpsReal, windowWidth, windowHeight, wd, saveArea, os, uptimeMs, logCount` |
| `globals.get` | `names: string[]` | `values: {name: value}` (`{__missing:true}` when absent) |
| `globals.set` | `values: {name: value}` | `set: [names]` |
| `instances.list` | `object?`, `fields?: string[]`, `limit?` | `instances: [{id, object, …fields}], total` |
| `instances.get` | `id` | `instance: {id, object, vars: {…}}` (methods skipped) |
| `instances.set` | `id`, `values` | `set: [names]` |
| `instances.create` | `object`, `x?`, `y?`, `layer?`, `depth?` | `instance: <id>, object` |
| `instances.destroy` | `id` | `destroyed: true` |
| `rooms.change` | `room` | `room` (goto happens next step) |
| `functions.call` | `function`, `args?: any[]` | `result` (if serialisable) |
| `eval` | `code` | `result` — only when the game defines `__mcp_eval`/`execute_string` |
| `screenshot` | `path?` | `path`, `saveArea` — file lands in the save area |
| `keys` | `key` (name or code), `action?: press\|release\|clear` | `key`, `action` |
| `logs.get` | `since?` | `logs: string[]`, `total` |
| `game.speed` | `fps?` | `fps` (current) |

Values (`x`, `hp`, arrays, structs…) are JSON-converted on the GML side:
primitives pass through, arrays/structs are `json_stringify`→`json_parse`
round-tripped, references (`instance`, `sprite`…) are normalised to numbers,
methods and unserialisable values become `{__type, text}` markers.

---

## Write your own client

Any TCP client works. Minimal Node example:

```js
import net from "node:net";

const sock = net.createConnection({ host: "127.0.0.1", port: 18253 });
let buf = "";
sock.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    console.log("response:", msg);
  }
});
sock.on("connect", () => sock.write(JSON.stringify({ id: "1", cmd: "ping", args: {} }) + "\n"));
```

(The repo's `src/bridge.js` is a fuller implementation with request/response
matching, timeouts and port-scanning.)

---

## Inside the GML side (for contributors)

- `mcp_bridge_init` binds the server (retries ports), stores state in
  `global.mcp_bridge` (clients map, log, `owner` instance).
- The **owner instance** processes every async event — the async data buffer is
  shared per event and can only be read once, so extra bridge instances must
  not process traffic (they `exit` early).
- Incoming bytes are accumulated per client until `\n`, then parsed with
  `json_parse` and dispatched (`mcp_bridge_dispatch`).
- Responses are written with `network_send_raw` (JSON + newline).
- `exception_unhandled_handler(mcp_bridge_on_exception)` logs unhandled GML
  errors, writes `mcp_bridge_error.txt` to the save area and ends the game
  instead of showing a blocking error dialog.
- Clean Up closes all sockets.

Tuning (generated into the script by `gm_inject_bridge`): `port`, `logLimit`,
`maxLineBytes`, `maxClients`, `verbose` (mirrors bridge logs to
`show_debug_message`, visible in `gm_read_game_log`).
