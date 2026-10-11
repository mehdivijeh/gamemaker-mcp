/// MCP bridge - Step event: retry the socket bind once a second if needed.
if (id != global.mcp_bridge.owner) exit;
if (global.mcp_bridge.server < 0 && (current_time - global.mcp_bridge.lastTry) > 1000) {
    mcp_bridge_init(global.mcp_bridge.cfg);
}
