/// MCP bridge - Async Networking event (Other_68)
/// Runs for every bridge instance - only the owner processes the event
/// (async_load's buffer is shared and can only be read once).
if (id != global.mcp_bridge.owner) exit;

var _type = async_load[? "type"];

if (_type == network_type_connect) {
    var _sock = async_load[? "socket"];
    variable_struct_set(global.mcp_bridge.clients, string(_sock), {
        sock: _sock,
        buf: "",
        ip: async_load[? "ip"],
    });
    mcp_bridge_log("client connected: " + string(_sock));

} else if (_type == network_type_disconnect) {
    var _sock = async_load[? "socket"];
    variable_struct_remove(global.mcp_bridge.clients, string(_sock));
    mcp_bridge_log("client disconnected: " + string(_sock));

} else if (_type == network_type_data) {
    var _sock = async_load[? "id"];
    var _key = string(_sock);
    if (!variable_struct_exists(global.mcp_bridge.clients, _key)) {
        variable_struct_set(global.mcp_bridge.clients, _key, { sock: _sock, buf: "", ip: "?" });
    }
    var _c = variable_struct_get(global.mcp_bridge.clients, _key);
    var _buf = async_load[? "buffer"];
    var _size = async_load[? "size"];
    // defensive: never read past the buffer
    buffer_seek(_buf, buffer_seek_start, 0);
    var _n = min(_size, buffer_get_size(_buf));
    repeat (_n) {
        var _b = buffer_read(_buf, buffer_u8);
        if (_b == 10) {
            if (string_length(_c.buf) > 0) mcp_bridge_handle(_key, _c.buf);
            _c.buf = "";
        } else if (_b != 13) {
            _c.buf += chr(_b);
        }
    }
    if (string_length(_c.buf) > global.mcp_bridge.cfg.maxLineBytes) {
        _c.buf = "";
        mcp_bridge_log("dropped oversized request from " + _key);
    }
}
