# Client setup

Every MCP client works the same way: it spawns `node /ABSOLUTE/PATH/gamemaker-mcp/src/index.js`
and speaks MCP over stdin/stdout — or connects to the HTTP endpoint if the
client is remote-only. After editing a config, **restart the client** (or
reload its MCP servers) and ask the model to call **`gm_runtime_info`** to
verify.

> Replace `/path/to/gamemaker-mcp` below with your actual clone location
> (e.g. `/Users/you/gamemaker-mcp`). Config file names/formats below reflect
> client versions as of early 2026 — check your client's own docs if a path
> moved.

---

## Claude Desktop — macOS / Windows

`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gamemaker": {
      "command": "node",
      "args": ["/path/to/gamemaker-mcp/src/index.js"]
    }
  }
}
```

Fully quit (⌘Q) and reopen Claude.

---

## Claude Code (CLI)

```sh
claude mcp add gamemaker -- node /path/to/gamemaker-mcp/src/index.js
claude mcp list        # verify
```

Or commit a project-scoped `.mcp.json` in your repo root:

```json
{ "mcpServers": { "gamemaker": { "command": "node", "args": ["/path/to/gamemaker-mcp/src/index.js"] } } }
```

---

## Cline (VS Code extension)

Open **MCP Servers → Configure** (or edit the settings file directly):

`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "gamemaker": {
      "command": "node",
      "args": ["/path/to/gamemaker-mcp/src/index.js"],
      "disabled": false,
      "autoApprove": [
        "gm_runtime_info", "gm_list_projects", "gm_open_project", "gm_project_summary",
        "gm_list_resources", "gm_read_resource", "gm_search_gml", "gm_read_gml",
        "gm_list_object_events", "gm_list_room_instances", "gm_read_game_log",
        "gm_read_runtime_error", "gm_bridge_info", "gm_bridge_get_globals",
        "gm_bridge_list_instances", "gm_bridge_get_instance", "gm_bridge_logs"
      ]
    }
  }
}
```

`autoApprove` = read-only tools run without asking; anything that writes,
builds, launches or controls a game will still request approval.

---

## Cline CLI (terminal)

```sh
cline mcp add gamemaker -- node /path/to/gamemaker-mcp/src/index.js   # wizard
cline config mcp                                                       # verify
```

or write `~/.cline/data/settings/cline_mcp_settings.json` with the same JSON
as above. Start a **new** `cline` session afterwards.

---

## Cursor

`~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "gamemaker": { "command": "node", "args": ["/path/to/gamemaker-mcp/src/index.js"] }
  }
}
```

Enable it under **Settings → MCP**, then restart Cursor.

---

## Windsurf

`~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "gamemaker": { "command": "node", "args": ["/path/to/gamemaker-mcp/src/index.js"] }
  }
}
```

---

## VS Code (GitHub Copilot, agent mode)

`.vscode/mcp.json` in a workspace (note the `servers` key):

```json
{
  "servers": {
    "gamemaker": { "command": "node", "args": ["/path/to/gamemaker-mcp/src/index.js"] }
  }
}
```

---

## Zed

`~/.config/zed/settings.json`

```json
{
  "context_servers": {
    "gamemaker": {
      "command": { "path": "node", "args": ["/path/to/gamemaker-mcp/src/index.js"] }
    }
  }
}
```

---

## Continue

`~/.continue/config.yaml`

```yaml
mcpServers:
  - name: gamemaker
    command: node
    args:
      - /path/to/gamemaker-mcp/src/index.js
```

---

## Gemini CLI

`~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "gamemaker": { "command": "node", "args": ["/path/to/gamemaker-mcp/src/index.js"] }
  }
}
```

---

## Codex CLI (OpenAI)

`~/.codex/config.toml`

```toml
[mcp_servers.gamemaker]
command = "node"
args = ["/path/to/gamemaker-mcp/src/index.js"]
```

---

## Remote / web agents (streamable HTTP)

Some hosts can't spawn local processes (web apps, containers, other machines).
Run the server in HTTP mode:

```sh
node src/index.js --http 8737            # -> http://127.0.0.1:8737/mcp
GAMEMAKER_MCP_HTTP_HOST=0.0.0.0 node src/index.js --http 8737   # LAN (see security!)
```

Point the host at `http://<host>:8737/mcp` (streamable HTTP transport, sessions
via `Mcp-Session-Id`). For internet exposure put it behind an authenticating
tunnel/proxy — **the server has no auth of its own** and can edit your projects
and run games.

> Note: all clients share the same server process state (active project, live
> bridge). That's intended for a local single-user tool; run separate processes
> (different ports) if you need isolation.

---

## Anything else — generic stdio snippet

```json
{
  "mcpServers": {
    "gamemaker": {
      "command": "node",
      "args": ["/path/to/gamemaker-mcp/src/index.js"],
      "env": { "GAMEMAKER_PROJECT": "/optional/default/project.yyp" }
    }
  }
}
```

## Verify & debug

```sh
node /path/to/gamemaker-mcp/src/index.js   # prints "ready on stdio (...)" then waits
node /path/to/gamemaker-mcp/test/mcp-handshake.mjs   # protocol + runtime detection
```

If a client shows the server as failed, check its MCP log — the usual causes
are a wrong absolute path or Node not on `PATH` (use the full path to `node`,
e.g. `/usr/local/bin/node`, in that case).
